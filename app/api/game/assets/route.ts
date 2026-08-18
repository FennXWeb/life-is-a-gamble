import { getEditorUser } from "../../../editor/admin";
import { getGitHubMountConfig, githubError, normalizePath, readRepositoryBytes } from "../../../editor/github-mount";

export const dynamic = "force-dynamic";
const imageTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

export async function GET(request: Request) {
  if (!await getEditorUser()) return Response.json({ error: "Sign in to load game art." }, { status: 401 });
  const config = getGitHubMountConfig();
  if (!config) return Response.json({ error: "The GitHub mount is not configured." }, { status: 503 });
  try {
    const path = normalizePath(new URL(request.url).searchParams.get("path") || "");
    const extension = path.split(".").pop()?.toLowerCase() || "";
    if (!path.startsWith("public/game-assets/sprites/") || !imageTypes[extension]) return Response.json({ error: "Invalid sprite path." }, { status: 400 });
    const file = await readRepositoryBytes(config, path);
    return new Response(file.bytes, { headers: { "Content-Type": imageTypes[extension], "Cache-Control": "private, max-age=300", ...(file.etag ? { ETag: file.etag } : {}) } });
  } catch (error) {
    const issue = githubError(error);
    return Response.json({ error: issue.message }, { status: issue.status });
  }
}
