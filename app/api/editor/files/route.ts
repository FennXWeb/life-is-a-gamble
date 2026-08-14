import { requireEditorAdmin } from "../../../editor/admin";
import { getGitHubMountConfig, githubError, listRepositoryFiles, normalizePath, readRepositoryFile, writeRepositoryFile } from "../../../editor/github-mount";

export const dynamic = "force-dynamic";

const editableExtensions = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "md", "txt", "yaml", "yml", "toml", "html", "sql", "svg"]);

function isEditablePath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() || "";
  return editableExtensions.has(extension) && !path.startsWith(".git/") && !/(^|\/)\.env($|\.)/.test(path);
}

export async function GET(request: Request) {
  const auth = await requireEditorAdmin();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const config = getGitHubMountConfig();
  if (!config) return Response.json({ error: "The GitHub mount is not configured." }, { status: 503 });

  try {
    const path = new URL(request.url).searchParams.get("path");
    if (!path) {
      const tree = await listRepositoryFiles(config);
      return Response.json({ ...tree, repository: config.repository, branch: config.branch });
    }
    const safePath = normalizePath(path);
    const file = await readRepositoryFile(config, safePath);
    if (file.size > 1_000_000) return Response.json({ error: "Files larger than 1 MB are read-only in LIAG Editor." }, { status: 413 });
    return Response.json({ ...file, editable: isEditablePath(safePath) });
  } catch (error) {
    const issue = githubError(error);
    return Response.json({ error: issue.message }, { status: issue.status });
  }
}

export async function PUT(request: Request) {
  const auth = await requireEditorAdmin();
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const config = getGitHubMountConfig();
  if (!config) return Response.json({ error: "The GitHub mount is not configured." }, { status: 503 });

  try {
    const payload = await request.json() as { path?: string; content?: string; sha?: string; message?: string };
    const path = normalizePath(payload.path || "");
    if (!isEditablePath(path)) return Response.json({ error: "This file type is read-only in LIAG Editor." }, { status: 400 });
    if (typeof payload.content !== "string" || payload.content.length > 1_000_000) return Response.json({ error: "File content must be text under 1 MB." }, { status: 400 });
    if (!payload.sha) return Response.json({ error: "Reload this file before publishing changes." }, { status: 409 });
    const saved = await writeRepositoryFile(config, path, payload.content, payload.sha, payload.message?.trim().slice(0, 120) || `LIAG Editor: update ${path}`, { name: auth.user.displayName.slice(0, 80), email: auth.user.email });
    return Response.json({ sha: saved.sha, commit: { sha: saved.commitSha, url: saved.commitUrl } });
  } catch (error) {
    const issue = githubError(error);
    return Response.json({ error: issue.status === 409 || issue.status === 422 ? "The file changed on the testing branch. Reload it before publishing." : issue.message }, { status: issue.status });
  }
}
