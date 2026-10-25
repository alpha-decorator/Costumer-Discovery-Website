export type AuthErrorCode = "invalid_code" | "other_org" | "invalid_input" | "invalid_name" | "invalid_email" | "weak_password" | "email_taken" | "invalid_credentials" | "too_many_attempts" | "forbidden" | "server_error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const text = (value: unknown) => typeof value === "string" ? value : "";

export function validateEmail(value: unknown) {
  const email = text(value).trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function validateRegistration(body: unknown): { ok: true; value: { name: string; email: string; password: string } } | { ok: false; error: AuthErrorCode } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_input" };
  const input = body as Record<string, unknown>;
  const email = validateEmail(input.email);
  if (!email) return { ok: false, error: "invalid_email" };
  const password = text(input.password);
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { ok: false, error: "weak_password" };
  const name = text(input.name).trim().replace(/\s+/g, " ") || email.split("@")[0];
  if (name.length > 80) return { ok: false, error: "invalid_name" };
  return { ok: true, value: { name, email, password } };
}

export function validateLogin(body: unknown): { ok: true; value: { email: string; password: string } } | { ok: false; error: AuthErrorCode } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_input" };
  const input = body as Record<string, unknown>;
  const email = validateEmail(input.email);
  const password = text(input.password);
  if (!email || !password || password.length > PASSWORD_MAX) return { ok: false, error: "invalid_credentials" };
  return { ok: true, value: { email, password } };
}
