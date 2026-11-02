import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { neon } from "@neondatabase/serverless";

/** Shared connection helpers. Local development uses SQLite; Vercel uses Postgres via DATABASE_URL. */
export const dataDir = join(process.cwd(), "data");
export const sqlitePath = join(dataDir, "interviews.sqlite");

export const usingPostgres = () => Boolean(process.env.DATABASE_URL);

let neonClient: ReturnType<typeof neon> | undefined;

export function postgres() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for persistent Vercel storage.");
  neonClient ??= neon(url);
  return neonClient;
}

export function openSqlite() {
  // Vercel's filesystem is read-only, so the SQLite file cannot be created there. Say what is missing instead of a raw filesystem error.
  if (process.env.VERCEL) throw new Error("DATABASE_URL is not set. Add a Postgres database (for example Neon from the Vercel Marketplace) to this project and redeploy.");
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(sqlitePath);
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function isUniqueViolation(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ""}` : String(error);
  return /UNIQUE constraint failed|duplicate key value|23505/i.test(text);
}
