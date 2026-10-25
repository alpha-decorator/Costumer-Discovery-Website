/** Server-side helpers for talking to the Trata engine (the Python program in /engine). The browser never calls it directly. */
export const engineUrl = () => (process.env.ENGINE_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
export const MAX_UPLOAD_BYTES = 600 * 1024 * 1024;

export function engineHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (process.env.ENGINE_TOKEN) headers.Authorization = `Bearer ${process.env.ENGINE_TOKEN}`;
  return headers;
}

/** The engine caches finished jobs by this key, so it includes the user: two accounts must never share a cached result. */
export const scopedKey = (userId: string, key: string) => (key ? `${userId}:${key}` : "");
