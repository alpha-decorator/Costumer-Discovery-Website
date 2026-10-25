import { randomUUID } from "node:crypto";
import { isUniqueViolation, openSqlite, postgres, usingPostgres } from "./db";

export type User = {
  id: string; email: string; name: string;
  passwordHash: string | null; googleSub: string | null; emailVerified: boolean;
  failedAttempts: number; lockedUntil: number;
};

export class EmailTakenError extends Error {
  constructor() { super("An account with this email already exists."); }
}

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 10 * 60 * 1000;

let postgresReady: Promise<void> | undefined;

function sqliteDb() {
  const db = openSqlite();
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT, google_sub TEXT UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`);
  return db;
}

async function pg() {
  const sql = postgres();
  postgresReady ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT, google_sub TEXT UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    )`;
  })().catch((error) => { postgresReady = undefined; throw error; });
  await postgresReady;
  return sql;
}

function fromRow(row: Record<string, unknown> | undefined | null): User | null {
  if (!row) return null;
  return {
    id: String(row.id), email: String(row.email), name: String(row.name),
    passwordHash: row.password_hash == null ? null : String(row.password_hash),
    googleSub: row.google_sub == null ? null : String(row.google_sub),
    emailVerified: Number(row.email_verified) === 1,
    failedAttempts: Number(row.failed_attempts), lockedUntil: Number(row.locked_until),
  };
}

export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }

export async function findUserByEmail(email: string) {
  const key = normalizeEmail(email);
  if (usingPostgres()) {
    const sql = await pg();
    return fromRow((await sql`SELECT * FROM users WHERE email = ${key}` as Record<string, unknown>[])[0]);
  }
  const db = sqliteDb();
  try { return fromRow(db.prepare("SELECT * FROM users WHERE email = ?").get(key) as Record<string, unknown> | undefined); }
  finally { db.close(); }
}

export async function findUserByGoogleSub(sub: string) {
  if (usingPostgres()) {
    const sql = await pg();
    return fromRow((await sql`SELECT * FROM users WHERE google_sub = ${sub}` as Record<string, unknown>[])[0]);
  }
  const db = sqliteDb();
  try { return fromRow(db.prepare("SELECT * FROM users WHERE google_sub = ?").get(sub) as Record<string, unknown> | undefined); }
  finally { db.close(); }
}

/** Returns `isFirst: true` for the very first account, which adopts any interviews saved before accounts existed. */
export async function createUser(input: { email: string; name: string; passwordHash?: string; googleSub?: string; emailVerified: boolean }) {
  const id = randomUUID();
  const email = normalizeEmail(input.email);
  const now = Date.now();
  try {
    if (usingPostgres()) {
      const sql = await pg();
      const count = Number(((await sql`SELECT COUNT(*) AS n FROM users` as Record<string, unknown>[])[0]?.n) ?? 0);
      await sql`INSERT INTO users (id,email,name,password_hash,google_sub,email_verified,created_at)
        VALUES (${id},${email},${input.name},${input.passwordHash ?? null},${input.googleSub ?? null},${input.emailVerified ? 1 : 0},${now})`;
      return { user: (await findUserByEmail(email))!, isFirst: count === 0 };
    }
    const db = sqliteDb();
    try {
      const count = Number((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n);
      db.prepare(`INSERT INTO users (id,email,name,password_hash,google_sub,email_verified,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(id, email, input.name, input.passwordHash ?? null, input.googleSub ?? null, input.emailVerified ? 1 : 0, now);
      return { user: fromRow(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown>)!, isFirst: count === 0 };
    } finally { db.close(); }
  } catch (error) {
    if (isUniqueViolation(error)) throw new EmailTakenError();
    throw error;
  }
}

/**
 * Attach a Google identity to an existing account that has the same email.
 * Password sign-ups are not email-verified, so if the account was created that way we remove its password:
 * otherwise someone could pre-register a victim's address and keep access after the real owner signs in with Google.
 */
export async function linkGoogleAccount(user: User, googleSub: string) {
  const clearPassword = !user.emailVerified;
  if (usingPostgres()) {
    const sql = await pg();
    await sql`UPDATE users SET google_sub = ${googleSub}, email_verified = 1,
      password_hash = CASE WHEN ${clearPassword} THEN NULL ELSE password_hash END WHERE id = ${user.id}`;
    return;
  }
  const db = sqliteDb();
  try {
    db.prepare("UPDATE users SET google_sub = ?, email_verified = 1, password_hash = CASE WHEN ? = 1 THEN NULL ELSE password_hash END WHERE id = ?")
      .run(googleSub, clearPassword ? 1 : 0, user.id);
  } finally { db.close(); }
}

export async function recordFailedLogin(user: User) {
  const attempts = user.failedAttempts + 1;
  const locked = attempts >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = locked ? Date.now() + LOCKOUT_MS : 0;
  const stored = locked ? 0 : attempts;
  if (usingPostgres()) {
    const sql = await pg();
    await sql`UPDATE users SET failed_attempts = ${stored}, locked_until = ${lockedUntil} WHERE id = ${user.id}`;
    return;
  }
  const db = sqliteDb();
  try { db.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(stored, lockedUntil, user.id); }
  finally { db.close(); }
}

export async function clearFailedLogins(user: User) {
  if (user.failedAttempts === 0 && user.lockedUntil === 0) return;
  if (usingPostgres()) {
    const sql = await pg();
    await sql`UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ${user.id}`;
    return;
  }
  const db = sqliteDb();
  try { db.prepare("UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?").run(user.id); }
  finally { db.close(); }
}
