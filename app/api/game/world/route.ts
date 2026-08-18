import { loadBundledProject, loadMountedProject } from "../../../editor/project-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const mounted = await loadMountedProject();
    return Response.json(mounted, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ project: loadBundledProject(), source: "bundled", branch: "testing" }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
