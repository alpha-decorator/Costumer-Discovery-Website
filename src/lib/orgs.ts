import { randomInt, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isUniqueViolation, openSqlite, postgres, usingPostgres } from "./db";
import { CODE_MAX, CODE_MIN, normalizeCode } from "./org-code";

export { CODE_MAX, CODE_MIN, normalizeCode };

/**
 * Organisations ("business codes"). Colleagues who sign in with the same code share one set of interviews: they are saved under the
 * workspace key `org:<id>` instead of a person's user id, so every query that is already scoped to an owner key keeps working.
 * One person belongs to at most one organisation.
 */
export type Org = { id: string; name: string; code: string; ownerId: string; createdAt: number };
export type Role = "owner" | "member";
export type Membership = { org: Org; role: Role };
export type Member = { userId: string; name: string; email: string; role: Role; joinedAt: number };

export class CodeTakenError extends Error { constructor() { super("That business code is already in use."); } }
export class AlreadyInOrgError extends Error { constructor() { super("This account already belongs to an organization."); } }

export const NAME_MAX = 80;
// No 0/O/1/I, so a code read out over the phone cannot be misheard.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const workspaceKey = (orgId: string) => `org:${orgId}`;

export function validateOrgName(input: unknown): string | null {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

/** Name given to a business when the person did not type one. */
export function defaultOrgName(userName: string) {
  const first = userName.trim().split(/\s+/)[0] ?? "";
  const name = first ? `${first}'s team` : "My team";
  return validateOrgName(name) ?? "My team";
}

/** A random code such as K7QD-M2XF (about 40 bits, so it cannot be guessed). */
export function generateCode() {
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

let postgresReady: Promise<void> | undefined;

const SQLITE_TABLES = [
  `CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, created_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memberships (user_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, role TEXT NOT NULL, created_at BIGINT NOT NULL)`,
];

async function run<T>(sqliteWork: (db: DatabaseSync) => T, postgresWork: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  if (usingPostgres()) {
    const sql = postgres();
    postgresReady ??= (async () => {
      await sql`CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, created_at BIGINT NOT NULL)`;
      await sql`CREATE TABLE IF NOT EXISTS memberships (user_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, role TEXT NOT NULL, created_at BIGINT NOT NULL)`;
    })().catch((error) => { postgresReady = undefined; throw error; });
    await postgresReady;
    return postgresWork(sql);
  }
  const db = openSqlite();
  try {
    for (const statement of SQLITE_TABLES) db.exec(statement);
    return sqliteWork(db);
  } finally { db.close(); }
}

const toOrg = (row: Record<string, unknown> | undefined | null): Org | null => row ? ({
  id: String(row.id), name: String(row.name), code: String(row.code), ownerId: String(row.owner_id), createdAt: Number(row.created_at),
}) : null;

export const findOrgByCode = (code: string) => run(
  (db) => toOrg(db.prepare("SELECT * FROM organizations WHERE code = ?").get(code) as Record<string, unknown> | undefined),
  async (sql) => toOrg((await sql`SELECT * FROM organizations WHERE code = ${code}` as Record<string, unknown>[])[0]),
);

export const findOrgById = (id: string) => run(
  (db) => toOrg(db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as Record<string, unknown> | undefined),
  async (sql) => toOrg((await sql`SELECT * FROM organizations WHERE id = ${id}` as Record<string, unknown>[])[0]),
);

export const getMembership = (userId: string): Promise<Membership | null> => run(
  (db) => {
    const row = db.prepare("SELECT o.*, m.role AS member_role FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = ?").get(userId) as Record<string, unknown> | undefined;
    return row ? { org: toOrg(row)!, role: row.member_role as Role } : null;
  },
  async (sql) => {
    const row = (await sql`SELECT o.*, m.role AS member_role FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = ${userId}` as Record<string, unknown>[])[0];
    return row ? { org: toOrg(row)!, role: row.member_role as Role } : null;
  },
);

export const isMember = (userId: string, orgId: string) => run(
  (db) => Boolean(db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?").get(userId, orgId)),
  async (sql) => (await sql`SELECT 1 AS x FROM memberships WHERE user_id = ${userId} AND org_id = ${orgId}` as unknown[]).length > 0,
);

/** Creates the organisation and makes `ownerId` its owner. Throws CodeTakenError or AlreadyInOrgError. */
export async function createOrg(input: { name: string; code: string; ownerId: string }): Promise<Org> {
  if (await getMembership(input.ownerId)) throw new AlreadyInOrgError();
  const id = randomUUID(), now = Date.now();
  try {
    await run(
      (db) => {
        db.prepare("INSERT INTO organizations (id,name,code,owner_id,created_at) VALUES (?,?,?,?,?)").run(id, input.name, input.code, input.ownerId, now);
        db.prepare("INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (?,?,?,?)").run(input.ownerId, id, "owner", now);
      },
      async (sql) => {
        await sql`INSERT INTO organizations (id,name,code,owner_id,created_at) VALUES (${id},${input.name},${input.code},${input.ownerId},${now})`;
        await sql`INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (${input.ownerId},${id},'owner',${now})`;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A unique violation here is either the code or (in a race) the owner's membership; the code is by far the likelier.
      if (await getMembership(input.ownerId)) throw new AlreadyInOrgError();
      throw new CodeTakenError();
    }
    throw error;
  }
  return { id, name: input.name, code: input.code, ownerId: input.ownerId, createdAt: now };
}

/** Adds the user to the organisation (nothing happens if already a member). Throws AlreadyInOrgError for a different organisation. */
export async function joinOrg(userId: string, org: Org): Promise<Role> {
  const current = await getMembership(userId);
  if (current) {
    if (current.org.id === org.id) return current.role;
    throw new AlreadyInOrgError();
  }
  const now = Date.now();
  try {
    await run(
      (db) => { db.prepare("INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (?,?,'member',?)").run(userId, org.id, now); },
      async (sql) => { await sql`INSERT INTO memberships (user_id,org_id,role,created_at) VALUES (${userId},${org.id},'member',${now})`; },
    );
  } catch (error) {
    if (isUniqueViolation(error)) return joinOrg(userId, org);
    throw error;
  }
  return "member";
}

/** Owner only (checked by the caller): rename and/or change the code. Members who already joined stay in. */
export async function updateOrg(orgId: string, changes: { name?: string; code?: string }) {
  try {
    await run(
      (db) => {
        if (changes.name !== undefined) db.prepare("UPDATE organizations SET name = ? WHERE id = ?").run(changes.name, orgId);
        if (changes.code !== undefined) db.prepare("UPDATE organizations SET code = ? WHERE id = ?").run(changes.code, orgId);
      },
      async (sql) => {
        if (changes.name !== undefined) await sql`UPDATE organizations SET name = ${changes.name} WHERE id = ${orgId}`;
        if (changes.code !== undefined) await sql`UPDATE organizations SET code = ${changes.code} WHERE id = ${orgId}`;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new CodeTakenError();
    throw error;
  }
}

export const listMembers = (orgId: string): Promise<Member[]> => run(
  (db) => (db.prepare(`SELECT m.user_id, m.role, m.created_at, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at`).all(orgId) as Record<string, unknown>[])
    .map((row) => ({ userId: String(row.user_id), name: String(row.name), email: String(row.email), role: row.role as Role, joinedAt: Number(row.created_at) })),
  async (sql) => (await sql`SELECT m.user_id, m.role, m.created_at, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ${orgId} ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.created_at` as Record<string, unknown>[])
    .map((row) => ({ userId: String(row.user_id), name: String(row.name), email: String(row.email), role: row.role as Role, joinedAt: Number(row.created_at) })),
);

/** Removes a member (never the owner). Returns whether someone was removed. */
export const removeMember = (orgId: string, userId: string): Promise<boolean> => run(
  (db) => Number(db.prepare("DELETE FROM memberships WHERE org_id = ? AND user_id = ? AND role <> 'owner'").run(orgId, userId).changes) > 0,
  async (sql) => (await sql`DELETE FROM memberships WHERE org_id = ${orgId} AND user_id = ${userId} AND role <> 'owner' RETURNING user_id` as unknown[]).length > 0,
);
