import { createDefaultProject } from "../../../editor/default-project";
import { requireEditorAdmin } from "../../../editor/admin";
import { getGitHubMountConfig, getGitHubMountTarget, githubError, readRepositoryFile, writeRepositoryFile } from "../../../editor/github-mount";
import type { GameProject } from "../../../editor/project-types";
import { builtInSprites, builtInSyracuseScene } from "../../../editor/builtin-sprites";

export const dynamic = "force-dynamic";

function validateProject(value: unknown): value is GameProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<GameProject>;
  const collections = [project.levels, project.cells, project.lootTables, project.npcs, project.spawners, project.quests];
  if (project.schemaVersion !== 1 || project.game !== "Life is a Gamble" || collections.some((entry) => !Array.isArray(entry))) return false;
  const extendedCollections = [project.spriteAssets, project.levelLayers, project.levelObjects].filter((entry) => entry !== undefined);
  if (extendedCollections.some((entry) => !Array.isArray(entry))) return false;
  const allIds = [...collections, ...extendedCollections].flatMap((collection) => (collection || []).map((entry) => (entry as { id?: string }).id));
  return allIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 100);
}

function upgradeProject(project: GameProject): GameProject {
  project.spriteAssets ||= [];
  project.levelLayers ||= [];
  project.levelObjects ||= [];
  for (const level of project.levels) {
    if (!project.levelLayers.some((layer) => layer.levelId === level.id)) {
      project.levelLayers.push(
        { id: `${level.id}-terrain`, levelId: level.id, name: "Terrain", kind: "terrain", visible: true, locked: false, opacity: 1 },
        { id: `${level.id}-objects`, levelId: level.id, name: "Objects", kind: "objects", visible: true, locked: false, opacity: 1 },
        { id: `${level.id}-collision`, levelId: level.id, name: "Collision", kind: "collision", visible: true, locked: false, opacity: 0.65 },
        { id: `${level.id}-entities`, levelId: level.id, name: "Entities", kind: "entities", visible: true, locked: false, opacity: 1 },
      );
    }
    if (level.id === "syracuse-salt-yard" && !project.levelObjects.some((object) => object.levelId === level.id)) {
      const levelLayers = project.levelLayers.filter((layer) => layer.levelId === level.id);
      const objectLayer = levelLayers.find((layer) => layer.kind === "objects") || levelLayers[0];
      const entityLayer = levelLayers.find((layer) => layer.kind === "entities") || objectLayer;
      if (objectLayer && entityLayer) project.levelObjects.push(...builtInSyracuseScene(objectLayer.id, entityLayer.id));
    }
  }
  const knownSpriteIds = new Set(project.spriteAssets.map((asset) => asset.id));
  project.spriteAssets.push(...builtInSprites().filter((asset) => !knownSpriteIds.has(asset.id)));
  return project;
}

export async function GET() {
  const auth = await requireEditorAdmin();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const config = getGitHubMountConfig();
  if (!config) {
    const target = getGitHubMountTarget();
    return Response.json({
      project: createDefaultProject(),
      mount: { mounted: false, repository: target.repository, branch: target.branch, path: target.dataPath, sha: null, message: `The main game repository is selected. Add its LIAG_GITHUB_TOKEN runtime secret to enable publishing to ${target.branch}.` },
    });
  }

  try {
    const file = await readRepositoryFile(config, config.dataPath);
    const project = JSON.parse(file.content) as unknown;
    if (!validateProject(project)) throw new Error("The mounted game-data file does not match LIAG Editor schema version 1.");
    return Response.json({ project: upgradeProject(project), mount: { mounted: true, repository: config.repository, branch: config.branch, path: config.dataPath, sha: file.sha } });
  } catch (error) {
    const issue = githubError(error);
    if (issue.status === 404) {
      return Response.json({ project: createDefaultProject(), mount: { mounted: true, repository: config.repository, branch: config.branch, path: config.dataPath, sha: null, message: "No project file exists yet. The first publish will create it." } });
    }
    return Response.json({ error: issue.message }, { status: issue.status });
  }
}

export async function PUT(request: Request) {
  const auth = await requireEditorAdmin();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const config = getGitHubMountConfig();
  if (!config) return Response.json({ error: "The GitHub mount is not configured." }, { status: 503 });

  try {
    const payload = await request.json() as { project?: unknown; sha?: string | null };
    if (!validateProject(payload.project)) return Response.json({ error: "The project document is invalid." }, { status: 400 });
    const project = upgradeProject({ ...payload.project, updatedAt: new Date().toISOString() });
    const encoded = JSON.stringify(project, null, 2) + "\n";
    if (encoded.length > 4_000_000) return Response.json({ error: "The project is too large for a single mounted game-data document." }, { status: 413 });
    const saved = await writeRepositoryFile(config, config.dataPath, encoded, payload.sha || null, "LIAG Editor: publish game data", { name: auth.user.displayName.slice(0, 80), email: auth.user.email });
    return Response.json({ project, mount: { mounted: true, repository: config.repository, branch: config.branch, path: config.dataPath, sha: saved.sha }, commit: { sha: saved.commitSha, url: saved.commitUrl } });
  } catch (error) {
    const issue = githubError(error);
    return Response.json({ error: issue.status === 409 || issue.status === 422 ? "The testing branch changed since this project was loaded. Reload before publishing so newer work is not overwritten." : issue.message }, { status: issue.status });
  }
}
