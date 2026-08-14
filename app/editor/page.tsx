import { redirect } from "next/navigation";
import Link from "next/link";
import { chatGPTSignInPath } from "../chatgpt-auth";
import { getEditorUser, isEditorAdmin } from "./admin";
import { EditorShell } from "./editor-shell";
import styles from "./editor.module.css";

export const dynamic = "force-dynamic";

export default function EditorPage() {
  return <EditorGate />;
}

async function EditorGate() {
  const user = await getEditorUser();
  if (!user) redirect(chatGPTSignInPath("/editor"));
  if (!isEditorAdmin(user.email)) {
    return <main className={styles.accessPage}>
      <section>
        <span>LIAG / RESTRICTED SYSTEM</span>
        <h1>Admin clearance required</h1>
        <p>{user.email} is signed in, but is not listed in <code>LIAG_EDITOR_ADMIN_EMAILS</code>.</p>
        <Link href="/">Return to Life is a Gamble</Link>
      </section>
    </main>;
  }
  return <EditorShell user={{ name: user.displayName, email: user.email }} />;
}
