export type GitHubMountConfig = {
  repository: string;
  branch: string;
  dataPath: string;
  token: string;
};

export const MAIN_GAME_REPOSITORY = "FennXWeb/life-is-a-gamble";

export type GitHubMountTarget = Omit<GitHubMountConfig, "token">;

type GitHubContent = {
  type: "file";
  sha: string;
  path: string;
  size: number;
  encoding: "base64";
  content: string;
};

export function getGitHubMountTarget(): GitHubMountTarget {
  const configuredRepository = process.env.LIAG_GITHUB_REPOSITORY?.trim() || MAIN_GAME_REPOSITORY;
  const repository = /^[\w.-]+\/[\w.-]+$/.test(configuredRepository) ? configuredRepository : MAIN_GAME_REPOSITORY;
  return {
    repository,
    branch: process.env.LIAG_GITHUB_BRANCH?.trim() || "testing",
    dataPath: normalizePath(process.env.LIAG_GITHUB_DATA_PATH?.trim() || "game-data/editor-project.json"),
  };
}

export function getGitHubMountConfig(): GitHubMountConfig | null {
  const target = getGitHubMountTarget();
  const token = process.env.LIAG_GITHUB_TOKEN?.trim() || "";
  if (!token) return null;
  return { ...target, token };
}

export function normalizePath(path: string) {
  const clean = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\0")) throw new Error("Invalid repository path.");
  return clean;
}

function contentUrl(config: GitHubMountConfig, path: string) {
  const encodedPath = normalizePath(path).split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${config.repository}/contents/${encodedPath}`;
}

async function githubFetch(config: GitHubMountConfig, url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    const error = new Error(payload.message || `GitHub returned ${response.status}.`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response;
}

function decodeBase64Utf8(content: string) {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(content: string) {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function readRepositoryFile(config: GitHubMountConfig, path: string) {
  const response = await githubFetch(config, `${contentUrl(config, path)}?ref=${encodeURIComponent(config.branch)}`);
  const payload = await response.json() as GitHubContent;
  if (payload.type !== "file" || payload.encoding !== "base64") throw new Error("The selected repository path is not a readable file.");
  return { content: decodeBase64Utf8(payload.content), sha: payload.sha, path: payload.path, size: payload.size };
}

export async function writeRepositoryFile(
  config: GitHubMountConfig,
  path: string,
  content: string,
  sha: string | null,
  message: string,
  author: { name: string; email: string },
) {
  const body: Record<string, unknown> = {
    message,
    content: encodeBase64Utf8(content),
    branch: config.branch,
    committer: author,
  };
  if (sha) body.sha = sha;
  const response = await githubFetch(config, contentUrl(config, path), { method: "PUT", body: JSON.stringify(body) });
  const payload = await response.json() as { content?: { sha?: string }; commit?: { sha?: string; html_url?: string } };
  return { sha: payload.content?.sha || null, commitSha: payload.commit?.sha || null, commitUrl: payload.commit?.html_url || null };
}

export async function listRepositoryFiles(config: GitHubMountConfig) {
  const url = `https://api.github.com/repos/${config.repository}/git/trees/${encodeURIComponent(config.branch)}?recursive=1`;
  const response = await githubFetch(config, url);
  const payload = await response.json() as { truncated?: boolean; tree?: Array<{ path: string; type: string; size?: number; sha: string }> };
  return {
    truncated: Boolean(payload.truncated),
    files: (payload.tree || []).filter((entry) => entry.type === "blob").map((entry) => ({ path: entry.path, size: entry.size || 0, sha: entry.sha })),
  };
}

export function githubError(error: unknown) {
  const status = error instanceof Error && "status" in error ? Number((error as Error & { status?: number }).status) : 500;
  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: error instanceof Error ? error.message : "The repository mount failed.",
  };
}
