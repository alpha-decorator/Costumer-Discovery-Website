/**
 * A small in-memory brake on guessing business codes. It counts failed guesses per client address (or per user) in the last ten
 * minutes. On a serverless host each instance keeps its own count, so this is a best-effort extra; the real protection is that a code
 * is long and random, and that a code alone never signs anyone in (a valid account password is always needed as well).
 */
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 10;
const misses = new Map<string, number[]>();

function recent(key: string, now: number) {
  const list = (misses.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
  if (list.length) misses.set(key, list); else misses.delete(key);
  return list;
}

export const clientKey = (request: Request) =>
  (request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "local").split(",")[0].trim() || "local";

export const tooManyCodeGuesses = (key: string, now = Date.now()) => recent(key, now).length >= LIMIT;

export function recordCodeGuess(key: string, now = Date.now()) {
  const list = recent(key, now);
  list.push(now);
  misses.set(key, list);
  if (misses.size > 5000) misses.delete(misses.keys().next().value as string);
}
