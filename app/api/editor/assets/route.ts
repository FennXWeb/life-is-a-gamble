import { requireEditorAdmin } from "../../../editor/admin";
import { getGitHubMountConfig, githubError, normalizePath, readRepositoryBytes, writeRepositoryBase64 } from "../../../editor/github-mount";

export const dynamic = "force-dynamic";

const imageTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function safeSpritePath(path: string) {
  const normalized = normalizePath(path);
  const extension = normalized.split(".").pop()?.toLowerCase() || "";
  if (!normalized.startsWith("public/game-assets/sprites/") || !imageTypes[extension]) throw new Error("Only imported sprite images can be read here.");
  return { path: normalized, contentType: imageTypes[extension] };
}

export async function GET(request: Request) {
  const auth = await requireEditorAdmin();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const config = getGitHubMountConfig();
  if (!config) return Response.json({ error: "The GitHub mount is not configured." }, { status: 503 });
  try {
    const target = safeSpritePath(new URL(request.url).searchParams.get("path") || "");
    const file = await readRepositoryBytes(config, target.path);
    const headers: Record<string, string> = { "Content-Type": target.contentType, "Cache-Control": "private, max-age=300" };
    if (file.etag) headers.ETag = file.etag;
    return new Response(file.bytes, { headers });
  } catch (error) {
    const issue = githubError(error);
    return Response.json({ error: issue.message }, { status: issue.status });
  }
}

export async function POST(request: Request) {
  const auth = await requireEditorAdmin();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const config = getGitHubMountConfig();
  if (!config) return Response.json({ error: "The GitHub mount is not configured." }, { status: 503 });
  try {
    const payload = await request.json() as { filename?: string; content?: string };
    const original = (payload.filename || "sprite.png").trim();
    const extension = original.split(".").pop()?.toLowerCase() || "";
    if (!imageTypes[extension]) return Response.json({ error: "Import a PNG, JPG, WebP, or GIF image." }, { status: 400 });
    if (typeof payload.content !== "string" || !/^[A-Za-z0-9+/=\s]+$/.test(payload.content)) return Response.json({ error: "The sprite payload is invalid." }, { status: 400 });
    const byteSize = Math.floor(payload.content.replace(/\s/g, "").length * 0.75);
    if (byteSize <= 0 || byteSize > 4_000_000) return Response.json({ error: "Sprites must be smaller than 4 MB." }, { status: 413 });
    const basename = original.slice(0, -(extension.length + 1)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "sprite";
    const path = `public/game-assets/sprites/${basename}-${Date.now().toString(36)}.${extension}`;
    const saved = await writeRepositoryBase64(config, path, payload.content, null, `LIAG Editor: import sprite ${original.slice(0, 80)}`, { name: auth.user.displayName.slice(0, 80), email: auth.user.email });
    return Response.json({ path, sha: saved.sha, commit: { sha: saved.commitSha, url: saved.commitUrl } });
  } catch (error) {
    const issue = githubError(error);
    return Response.json({ error: issue.message }, { status: issue.status });
  }
}
