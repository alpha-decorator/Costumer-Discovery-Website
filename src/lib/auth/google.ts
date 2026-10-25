/**
 * "Continue with Google" using the standard OAuth 2.0 authorization-code flow with PKCE.
 * Free: it only needs a Google Cloud OAuth client ID and secret (no paid service, no extra packages).
 */
export const OAUTH_COOKIE = "fieldnotes_oauth";
export const OAUTH_COOKIE_MAX_AGE = 600; // ten minutes to finish signing in

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Set AUTH_URL (for example https://your-app.vercel.app) if the app sits behind a proxy that hides its public address. */
export const appOrigin = (requestOrigin: string) => (process.env.AUTH_URL || requestOrigin).replace(/\/+$/, "");
export const googleRedirectUri = (origin: string) => `${origin}/api/auth/google/callback`;

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startGoogleSignIn(origin: string) {
  const state = randomToken();
  const verifier = randomToken(48);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url: `${AUTHORIZE_URL}?${params}`, state, verifier };
}

export type GoogleProfile = { sub: string; email: string; name: string };

export async function completeGoogleSignIn(origin: string, code: string, verifier: string): Promise<GoogleProfile> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: googleRedirectUri(origin),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google token exchange failed (${tokenResponse.status}).`);
  const { access_token: accessToken } = await tokenResponse.json() as { access_token?: string };
  if (!accessToken) throw new Error("Google did not return an access token.");

  const profileResponse = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!profileResponse.ok) throw new Error(`Google profile request failed (${profileResponse.status}).`);
  const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!profile.sub || !profile.email) throw new Error("Google did not share an email address.");
  if (profile.email_verified !== true) throw new Error("The Google account's email address is not verified.");
  return { sub: profile.sub, email: profile.email, name: (profile.name || profile.email.split("@")[0]).slice(0, 80) };
}

/** The OAuth cookie carries `state`, the PKCE verifier and where to go afterwards, separated by "." (all base64url / path-safe after encoding). */
export function packOAuthCookie(state: string, verifier: string, next: string, orgCode = "") {
  return [state, verifier, encodeURIComponent(next), encodeURIComponent(orgCode)].join(".");
}

export function unpackOAuthCookie(value: string | undefined) {
  const [state, verifier, next, orgCode, extra] = (value ?? "").split(".");
  if (!state || !verifier || extra !== undefined) return null;
  return { state, verifier, next: next ? decodeURIComponent(next) : "/", orgCode: orgCode ? decodeURIComponent(orgCode) : "" };
}
