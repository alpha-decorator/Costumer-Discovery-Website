import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const AUTH_PAGES = ["/login", "/register"];

/**
 * Signed-out visitors can only see the login and register pages. The /api/auth/* routes stay open (they are how you
 * sign in), and every other API route answers 401 instead of redirecting. Each API route re-checks the session itself.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  const user = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  const isAuthPage = AUTH_PAGES.includes(pathname);

  if (user) return isAuthPage ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (isAuthPage) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

// Static assets (including the speech and OCR models in /public) skip the check. So does /api/engine/jobs: audio uploads stream through it, and
// those routes check the session themselves (requireUser) so the request body is never buffered or cut off by the middleware layer.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.svg|models/|ocr/|api/engine/jobs).*)"] };
