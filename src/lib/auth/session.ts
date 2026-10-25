/**
 * Signed session cookies built on the Web Crypto API only, so this file runs in both the Edge middleware and
 * Node route handlers. The token is `base64url(JSON payload).base64url(HMAC-SHA256)`.
 */
export const SESSION_COOKIE = "fieldnotes_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // seven days, in seconds

/** `org` is set only while the person is working in their organization's shared workspace (signed in with a business code). */
export type SessionUser = { id: string; email: string; name: string; org?: string | null };
type SessionPayload = { sub: string; email: string; name: string; exp: number; org?: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
// Only used when AUTH_SECRET is missing during local development. Production refuses to run without a real secret.
const DEV_SECRET = "fieldnotes-local-development-secret-do-not-use-in-production";

function secret() {
  const configured = process.env.AUTH_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("Set AUTH_SECRET to a random string of at least 32 characters.");
  return DEV_SECRET;
}

/** Throws when production has no usable AUTH_SECRET. Sign-up calls it before it creates an account. */
export function assertSessionSecret() {
  secret();
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hmacKey() {
  return crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSessionToken(user: SessionUser, now = Date.now()) {
  const payload: SessionPayload = { sub: user.id, email: user.email, name: user.name, exp: Math.floor(now / 1000) + SESSION_MAX_AGE, ...(user.org ? { org: user.org } : {}) };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string | undefined | null, now = Date.now()): Promise<SessionUser | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    // crypto.subtle.verify compares the signature in constant time.
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(), fromBase64Url(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(fromBase64Url(parts[0]))) as Partial<SessionPayload>;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string" || typeof payload.name !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 <= now) return null;
    return { id: payload.sub, email: payload.email, name: payload.name, org: typeof payload.org === "string" && payload.org ? payload.org : null };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}
