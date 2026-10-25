/** Only allow redirects to a path on this site, never to another origin (open-redirect protection). */
export function safeNext(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\u0000-\u001f]/.test(value)) return "/";
  if (value.startsWith("/login") || value.startsWith("/register") || value.startsWith("/api/")) return "/";
  return value;
}
