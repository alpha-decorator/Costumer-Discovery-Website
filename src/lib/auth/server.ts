import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isMember, workspaceKey } from "../orgs";
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions, verifySessionToken, type SessionUser } from "./session";

/** The signed-in user for the current request, read from the signed session cookie (no database lookup). */
export async function getSessionUser() {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Browsers always send Origin on cross-site form posts; reject state-changing requests that come from another site. */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch { return false; }
}

/** Use at the top of an API route: returns the user, or a ready-made 401/403 response to return. */
export async function requireUser(request: Request): Promise<{ user: SessionUser; response?: undefined } | { user?: undefined; response: NextResponse }> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return { response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  const user = await getSessionUser();
  if (!user) return { response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { user };
}

/**
 * Like requireUser, but also says whose interviews this request may touch: the person's own, or (when they signed in with a business
 * code) the organization's. Membership is checked on every request so removing someone from the organization takes effect at once.
 */
export async function requireWorkspace(request: Request): Promise<
  { user: SessionUser; workspace: string; orgId: string | null; response?: undefined } | { user?: undefined; workspace?: undefined; orgId?: undefined; response: NextResponse }> {
  const checked = await requireUser(request);
  if (!checked.user) return checked;
  const orgId = checked.user.org ?? null;
  if (!orgId) return { user: checked.user, workspace: checked.user.id, orgId: null };
  if (!(await isMember(checked.user.id, orgId))) return { response: NextResponse.json({ error: "not_a_member" }, { status: 403 }) };
  return { user: checked.user, workspace: workspaceKey(orgId), orgId };
}

export async function attachSession<T extends NextResponse>(response: T, user: SessionUser) {
  response.cookies.set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions());
  return response;
}

export function clearSession<T extends NextResponse>(response: T) {
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
