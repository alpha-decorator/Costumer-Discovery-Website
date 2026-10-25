/** Rules for a business code, shared by the server (src/lib/orgs.ts) and the browser (so the form can explain a bad code before sending it). */
export const CODE_MIN = 6;
export const CODE_MAX = 24;

/** Upper-case letters, digits and hyphens, CODE_MIN to CODE_MAX long. Returns null when the text cannot be a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return /^[A-Z0-9-]+$/.test(code) && code.length >= CODE_MIN && code.length <= CODE_MAX ? code : null;
}
