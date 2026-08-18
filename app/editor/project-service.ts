import { createDefaultProject } from "./default-project";
import { builtInSprites, builtInSyracuseScene } from "./builtin-sprites";
import { getGitHubMountConfig, githubError, readRepositoryFile } from "./github-mount";
import type { GameProject } from "./project-types";

export function validateProject(value: unknown): value is GameProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<GameProject>;
  const collections = [project.levels, project.cells, project.lootTables, project.npcs, project.spawners, project.quests];
  if (project.schemaVersion !== 1 || project.game !== "Life is a Gamble" || collections.some((entry) => !Array.isArray(entry))) return false;
  const extended = [project.spriteAssets, project.levelLayers, project.levelObjects].filter((entry) => entry !== undefined);
  if (extended.some((entry) => !Array.isArray(entry))) return false;
  return [...collections, ...extended].flatMap((collection) => (collection || []).map((entry) => (entry as { id?: string }).id)).every((id) => typeof id === "string" && id.length > 0 && id.length <= 100);
}

export function upgradeProject(project: GameProject): GameProject {
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
      const layers = project.levelLayers.filter((layer) => layer.levelId === level.id);
      const objects = layers.find((layer) => layer.kind === "objects") || layers[0];
      const entities = layers.find((layer) => layer.kind === "entities") || objects;
      if (objects && entities) project.levelObjects.push(...builtInSyracuseScene(objects.id, entities.id));
    }
  }
  const known = new Set(project.spriteAssets.map((asset) => asset.id));
  project.spriteAssets.push(...builtInSprites().filter((asset) => !known.has(asset.id)));
  return project;
}

export async function loadMountedProject() {
  const config = getGitHubMountConfig();
  if (!config) return { project: createDefaultProject(), source: "bundled" as const, branch: "testing" };
  try {
    const file = await readRepositoryFile(config, config.dataPath);
    const parsed = JSON.parse(file.content) as unknown;
    if (!validateProject(parsed)) throw new Error("The mounted game-data file does not match LIAG Editor schema version 1.");
    return { project: upgradeProject(parsed), source: "github" as const, branch: config.branch, sha: file.sha };
  } catch (error) {
    const issue = githubError(error);
    if (issue.status === 404) return { project: createDefaultProject(), source: "bundled" as const, branch: config.branch };
    throw error;
  }
}
