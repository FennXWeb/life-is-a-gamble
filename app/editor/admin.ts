import { getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";

function adminEmails() {
  return new Set(
    (process.env.LIAG_EDITOR_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEditorAdmin(email: string) {
  return adminEmails().has(email.trim().toLowerCase());
}

export async function getEditorUser(): Promise<ChatGPTUser | null> {
  const authenticated = await getChatGPTUser();
  if (authenticated) return authenticated;

  const devEmail = process.env.NODE_ENV !== "production" ? process.env.LIAG_EDITOR_DEV_EMAIL?.trim() : "";
  if (!devEmail) return null;
  return { userId: "local-editor", email: devEmail, displayName: "Local editor", fullName: "Local editor" };
}

export async function requireEditorAdmin() {
  const user = await getEditorUser();
  if (!user) return { ok: false as const, status: 401, error: "Sign in to open LIAG Editor." };
  if (!isEditorAdmin(user.email)) return { ok: false as const, status: 403, error: "This account is not on the LIAG Editor admin allowlist." };
  return { ok: true as const, user };
}
