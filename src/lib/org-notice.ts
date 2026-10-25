/**
 * A one-line message that has to survive a full page reload (changing workspace reloads the page, because the session cookie changes).
 * The Business code screen shows it once after the reload: "Your code is ready", "You joined…". Storage can be blocked, so every call is guarded.
 */
export type OrgNotice = "created" | "create_failed" | "joined" | "switched_org" | "switched_personal" | "left";
const KEY = "fieldnotes-org-notice";
const KINDS: OrgNotice[] = ["created", "create_failed", "joined", "switched_org", "switched_personal", "left"];

export function setOrgNotice(kind: OrgNotice) {
  try { window.sessionStorage.setItem(KEY, kind); } catch { /* the page simply opens without the message */ }
}

export function peekOrgNotice(): OrgNotice | null {
  try { const value = window.sessionStorage.getItem(KEY); return KINDS.includes(value as OrgNotice) ? value as OrgNotice : null; } catch { return null; }
}

export function clearOrgNotice() {
  try { window.sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
