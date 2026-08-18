import { getEditorUser } from "../../../editor/admin";
import { loadMountedProject } from "../../../editor/project-service";
import { githubError } from "../../../editor/github-mount";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getEditorUser();
  if (!user) return Response.json({ error: "Sign in to load the game world." }, { status: 401 });
  try {
    const mounted = await loadMountedProject();
    return Response.json(mounted, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const issue = githubError(error);
    return Response.json({ error: issue.message }, { status: issue.status });
  }
}
