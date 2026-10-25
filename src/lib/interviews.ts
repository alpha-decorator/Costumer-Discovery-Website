import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dataDir, openSqlite, postgres, usingPostgres } from "./db";
import { ANALYSIS_CSV_HEADERS, analysisCsvColumns, analysisProblem, isValidAnalysis, type TrataAnalysis } from "./trata";

export type Interview = {
  id: string; name: string; initials: string; company: string; tier: "Expert" | "Public" | "Newbie";
  date: string; sentiment: number; transcript: string; language: "en" | "hi" | "mixed";
  topics: { UX: number; Pricing: number; Features: number }; keyPoints: string[]; audioName?: string;
  sourceType?: "audio" | "images" | "text"; imageNames?: string[];
  analysisEngine?: "trata-rules" | "multilingual-transformer" | "lexical-fallback" | "trata-engine";
  /** Full result of the Trata engine (idea sentiment, features, specific mentions, evidence). Absent for older records. */
  analysis?: TrataAnalysis;
  transcriptionStatus?: "processing" | "complete" | "interrupted";
};

// Local-development mirror of every saved interview (all accounts). Per-user exports are built from the database.
const csvPath = join(dataDir, "interviews.csv");

function database() {
  const db = openSqlite();
  db.exec(`CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, initials TEXT NOT NULL, company TEXT NOT NULL,
      tier TEXT NOT NULL, date TEXT NOT NULL, sentiment REAL NOT NULL, transcript TEXT NOT NULL,
      language TEXT NOT NULL, topics_json TEXT NOT NULL, key_points_json TEXT NOT NULL, audio_name TEXT,
      transcription_status TEXT NOT NULL DEFAULT 'complete'
    )`);
  const columns = db.prepare("PRAGMA table_info(interviews)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "transcription_status")) {
    db.exec("ALTER TABLE interviews ADD COLUMN transcription_status TEXT NOT NULL DEFAULT 'complete'");
  }
  if (!columns.some((column) => column.name === "source_type")) db.exec("ALTER TABLE interviews ADD COLUMN source_type TEXT NOT NULL DEFAULT 'audio'");
  if (!columns.some((column) => column.name === "image_names_json")) db.exec("ALTER TABLE interviews ADD COLUMN image_names_json TEXT NOT NULL DEFAULT '[]'");
  if (!columns.some((column) => column.name === "analysis_engine")) db.exec("ALTER TABLE interviews ADD COLUMN analysis_engine TEXT NOT NULL DEFAULT 'lexical-fallback'");
  if (!columns.some((column) => column.name === "user_id")) db.exec("ALTER TABLE interviews ADD COLUMN user_id TEXT");
  if (!columns.some((column) => column.name === "analysis_json")) db.exec("ALTER TABLE interviews ADD COLUMN analysis_json TEXT");
  if (!columns.some((column) => column.name === "uploaded_by")) db.exec("ALTER TABLE interviews ADD COLUMN uploaded_by TEXT");
  // Same table as orgs.ts; created here too because every interview query reads it.
  db.exec("CREATE TABLE IF NOT EXISTS memberships (user_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, role TEXT NOT NULL, created_at BIGINT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS interviews_user_idx ON interviews (user_id)");
  return db;
}

async function initializePostgres() {
  const sql = postgres();
  await sql`CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, initials TEXT NOT NULL, company TEXT NOT NULL,
    tier TEXT NOT NULL, date TEXT NOT NULL, sentiment DOUBLE PRECISION NOT NULL, transcript TEXT NOT NULL,
    language TEXT NOT NULL, topics_json TEXT NOT NULL, key_points_json TEXT NOT NULL, audio_name TEXT,
    transcription_status TEXT NOT NULL DEFAULT 'complete', source_type TEXT NOT NULL DEFAULT 'audio',
    image_names_json TEXT NOT NULL DEFAULT '[]', analysis_engine TEXT NOT NULL DEFAULT 'lexical-fallback', analysis_json TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'audio'`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS image_names_json TEXT NOT NULL DEFAULT '[]'`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS analysis_engine TEXT NOT NULL DEFAULT 'lexical-fallback'`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS user_id TEXT`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS analysis_json TEXT`;
  await sql`ALTER TABLE interviews ADD COLUMN IF NOT EXISTS uploaded_by TEXT`;
  await sql`CREATE TABLE IF NOT EXISTS memberships (user_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, role TEXT NOT NULL, created_at BIGINT NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS interviews_user_idx ON interviews (user_id)`;
  return sql;
}

function parseAnalysis(value: unknown): TrataAnalysis | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try { const parsed: unknown = JSON.parse(value); return isValidAnalysis(parsed) ? parsed : undefined; } catch { return undefined; }
}

function fromRow(row: Record<string, unknown>): Interview {
  return {
    id: String(row.id), name: String(row.name), initials: String(row.initials), company: String(row.company),
    tier: row.tier as Interview["tier"], date: String(row.date), sentiment: Number(row.sentiment),
    transcript: String(row.transcript), language: row.language as Interview["language"],
    topics: JSON.parse(String(row.topics_json)), keyPoints: JSON.parse(String(row.key_points_json)),
    audioName: row.audio_name == null ? undefined : String(row.audio_name),
    sourceType: (row.source_type as Interview["sourceType"]) || "audio",
    imageNames: JSON.parse(String(row.image_names_json || "[]")),
    analysisEngine: (row.analysis_engine as Interview["analysisEngine"]) || "lexical-fallback",
    analysis: parseAnalysis(row.analysis_json),
    transcriptionStatus: row.transcription_status as Interview["transcriptionStatus"],
  };
}

/** Text that starts with = + - @ would run as a formula when the CSV is opened in Excel, so it gets a leading apostrophe. Numbers are left alone. */
function csvCell(value: unknown) {
  let text = typeof value === "string" ? value : String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(records: Interview[]) {
  const headers = ["id", "date", "name", "company", "tier", "language", "sentiment", "topic_ux", "topic_pricing", "topic_features", "transcript", "key_points", "audio_name", "transcription_status", "source_type", "image_names", "analysis_engine", ...ANALYSIS_CSV_HEADERS];
  const rows = records.map((record) => {
    const extra = analysisCsvColumns(record.analysis);
    return [record.id, record.date, record.name, record.company, record.tier, record.language, record.sentiment,
      record.topics.UX, record.topics.Pricing, record.topics.Features, record.transcript, JSON.stringify(record.keyPoints), record.audioName ?? "", record.transcriptionStatus ?? "complete", record.sourceType ?? "audio", JSON.stringify(record.imageNames ?? []), record.analysisEngine ?? "lexical-fallback",
      ...ANALYSIS_CSV_HEADERS.map((header) => extra[header])].map(csvCell).join(",");
  });
  return `\uFEFF${[headers.map(csvCell).join(","), ...rows].join("\r\n")}\r\n`; // BOM so Excel shows Hindi correctly
}

function syncCsv(db: DatabaseSync) {
  const rows = db.prepare("SELECT * FROM interviews ORDER BY rowid DESC").all() as Record<string, unknown>[];
  const temporary = `${csvPath}.tmp`;
  writeFileSync(temporary, toCsv(rows.map(fromRow)), "utf8");
  renameSync(temporary, csvPath);
}

/** Every query below is scoped to an owner key (`userId`: a person's id, or `org:<id>` for an organization's shared interviews), so one workspace can never read or change another's. */
/**
 * Shared (organization) interviews stay visible only while the person who uploaded them is still a member. Leaving hides their uploads,
 * and rejoining shows them again; nothing is deleted. Personal interviews have no uploader and are always visible.
 * `orgId` is the organization the request works in, or null for a personal workspace.
 */
const VISIBLE_IN_ORG = "(uploaded_by IS NULL OR uploaded_by IN (SELECT user_id FROM memberships WHERE org_id = ?))";

export async function listInterviews(userId: string, orgId: string | null) {
  if (usingPostgres()) {
    const sql = await initializePostgres();
    const rows = await sql`SELECT * FROM interviews WHERE user_id = ${userId} AND (uploaded_by IS NULL OR uploaded_by IN (SELECT user_id FROM memberships WHERE org_id = ${orgId})) ORDER BY created_at DESC` as Record<string, unknown>[];
    return rows.map(fromRow);
  }
  const db = database();
  try {
    return (db.prepare(`SELECT * FROM interviews WHERE user_id = ? AND ${VISIBLE_IN_ORG} ORDER BY rowid DESC`).all(userId, orgId) as Record<string, unknown>[]).map(fromRow);
  } finally { db.close(); }
}

/** `uploadedBy` is the person saving it. It is recorded only in a shared (organization) workspace. */
export async function saveInterview(record: Interview, userId: string, uploadedBy: string) {
  const uploader = userId.startsWith("org:") ? uploadedBy : null;
  if (usingPostgres()) {
    const sql = await initializePostgres();
    await sql`INSERT INTO interviews (id,user_id,uploaded_by,name,initials,company,tier,date,sentiment,transcript,language,topics_json,key_points_json,audio_name,transcription_status,source_type,image_names_json,analysis_engine,analysis_json)
      VALUES (${record.id},${userId},${uploader},${record.name},${record.initials},${record.company},${record.tier},${record.date},${record.sentiment},${record.transcript},${record.language},${JSON.stringify(record.topics)},${JSON.stringify(record.keyPoints)},${record.audioName ?? null},${record.transcriptionStatus ?? "complete"},${record.sourceType ?? "audio"},${JSON.stringify(record.imageNames ?? [])},${record.analysisEngine ?? "lexical-fallback"},${record.analysis ? JSON.stringify(record.analysis) : null})`;
    return record;
  }
  const db = database();
  try {
    db.prepare(`INSERT INTO interviews (id,user_id,uploaded_by,name,initials,company,tier,date,sentiment,transcript,language,topics_json,key_points_json,audio_name,transcription_status,source_type,image_names_json,analysis_engine,analysis_json)
      VALUES (@id,@user_id,@uploaded_by,@name,@initials,@company,@tier,@date,@sentiment,@transcript,@language,@topics_json,@key_points_json,@audio_name,@transcription_status,@source_type,@image_names_json,@analysis_engine,@analysis_json)`).run({
      id: record.id, user_id: userId, uploaded_by: uploader, name: record.name, initials: record.initials, company: record.company, tier: record.tier,
      date: record.date, sentiment: record.sentiment, transcript: record.transcript, language: record.language,
      topics_json: JSON.stringify(record.topics), key_points_json: JSON.stringify(record.keyPoints), audio_name: record.audioName ?? null,
      transcription_status: record.transcriptionStatus ?? "complete",
      source_type: record.sourceType ?? "audio", image_names_json: JSON.stringify(record.imageNames ?? []), analysis_engine: record.analysisEngine ?? "lexical-fallback", analysis_json: record.analysis ? JSON.stringify(record.analysis) : null,
    });
    syncCsv(db);
    return record;
  } finally { db.close(); }
}

export async function updateInterview(id: string, record: Interview, userId: string, orgId: string | null) {
  if (usingPostgres()) {
    const sql = await initializePostgres();
    const updated = await sql`UPDATE interviews SET name=${record.name}, initials=${record.initials}, company=${record.company}, tier=${record.tier}, date=${record.date}, sentiment=${record.sentiment}, transcript=${record.transcript}, language=${record.language}, topics_json=${JSON.stringify(record.topics)}, key_points_json=${JSON.stringify(record.keyPoints)}, audio_name=${record.audioName ?? null}, transcription_status=${record.transcriptionStatus ?? "complete"}, source_type=${record.sourceType ?? "audio"}, image_names_json=${JSON.stringify(record.imageNames ?? [])}, analysis_engine=${record.analysisEngine ?? "lexical-fallback"}, analysis_json=${record.analysis ? JSON.stringify(record.analysis) : null} WHERE id=${id} AND user_id=${userId} AND (uploaded_by IS NULL OR uploaded_by IN (SELECT user_id FROM memberships WHERE org_id = ${orgId})) RETURNING id`;
    if (!Array.isArray(updated) || updated.length === 0) return null;
    return record;
  }
  const db = database();
  try {
    const result = db.prepare(`UPDATE interviews SET name=@name, initials=@initials, company=@company, tier=@tier,
      date=@date, sentiment=@sentiment, transcript=@transcript, language=@language, topics_json=@topics_json,
      key_points_json=@key_points_json, audio_name=@audio_name, transcription_status=@transcription_status, source_type=@source_type, image_names_json=@image_names_json, analysis_engine=@analysis_engine, analysis_json=@analysis_json WHERE id=@id AND user_id=@user_id AND ${VISIBLE_IN_ORG}`).run({
      id: record.id, user_id: userId, name: record.name, initials: record.initials, company: record.company, tier: record.tier,
      date: record.date, sentiment: record.sentiment, transcript: record.transcript, language: record.language,
      topics_json: JSON.stringify(record.topics), key_points_json: JSON.stringify(record.keyPoints), audio_name: record.audioName ?? null,
      transcription_status: record.transcriptionStatus ?? "complete",
      source_type: record.sourceType ?? "audio", image_names_json: JSON.stringify(record.imageNames ?? []), analysis_engine: record.analysisEngine ?? "lexical-fallback", analysis_json: record.analysis ? JSON.stringify(record.analysis) : null,
    });
    if (!result.changes) return null;
    syncCsv(db);
    return record;
  } finally { db.close(); }
}

/** Deletes one interview. Returns false when it does not exist in this workspace (or is hidden from it). */
export async function deleteInterview(id: string, ownerKey: string, orgId: string | null) {
  if (usingPostgres()) {
    const sql = await initializePostgres();
    const removed = await sql`DELETE FROM interviews WHERE id = ${id} AND user_id = ${ownerKey} AND (uploaded_by IS NULL OR uploaded_by IN (SELECT user_id FROM memberships WHERE org_id = ${orgId})) RETURNING id`;
    return Array.isArray(removed) && removed.length > 0;
  }
  const db = database();
  try {
    const result = db.prepare(`DELETE FROM interviews WHERE id = ? AND user_id = ? AND ${VISIBLE_IN_ORG}`).run(id, ownerKey, orgId);
    if (!result.changes) return false;
    syncCsv(db);
    return true;
  } finally { db.close(); }
}

/** Moves every interview from one workspace to another (a person's own interviews into their new organization), recording `uploadedBy` as their uploader. Returns how many moved. */
export async function moveInterviews(fromKey: string, toKey: string, uploadedBy: string) {
  if (usingPostgres()) {
    const sql = await initializePostgres();
    const moved = await sql`UPDATE interviews SET user_id = ${toKey}, uploaded_by = ${uploadedBy} WHERE user_id = ${fromKey} RETURNING id`;
    return Array.isArray(moved) ? moved.length : 0;
  }
  const db = database();
  try { return Number(db.prepare("UPDATE interviews SET user_id = ?, uploaded_by = ? WHERE user_id = ?").run(toKey, uploadedBy, fromKey).changes); }
  finally { db.close(); }
}

export async function countInterviews(ownerKey: string) {
  if (usingPostgres()) {
    const sql = await initializePostgres();
    return Number(((await sql`SELECT COUNT(*) AS n FROM interviews WHERE user_id = ${ownerKey}` as Record<string, unknown>[])[0]?.n) ?? 0);
  }
  const db = database();
  try { return Number((db.prepare("SELECT COUNT(*) AS n FROM interviews WHERE user_id = ?").get(ownerKey) as { n: number }).n); }
  finally { db.close(); }
}

/** CSV export of the current workspace's interviews only. */
export async function csvContents(userId: string, orgId: string | null) {
  return toCsv(await listInterviews(userId, orgId));
}

/** Interviews saved before accounts existed have no owner. The first account ever created adopts them. */
export async function claimOrphanInterviews(userId: string) {
  if (usingPostgres()) {
    const sql = await initializePostgres();
    await sql`UPDATE interviews SET user_id = ${userId} WHERE user_id IS NULL`;
    return;
  }
  const db = database();
  try { db.prepare("UPDATE interviews SET user_id = ? WHERE user_id IS NULL").run(userId); }
  finally { db.close(); }
}

/** Says which field of a submitted interview is wrong (so errors are fixable), or null when the record is fine. */
export function interviewProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") return "the record is not an object";
  const record = value as Partial<Interview>;
  const isScore = (score: unknown) => typeof score === "number" && Number.isFinite(score) && score >= -1 && score <= 1;
  const checks: [string, boolean][] = [
    ["id", typeof record.id === "string"], ["name", typeof record.name === "string"], ["initials", typeof record.initials === "string"],
    ["company", typeof record.company === "string"], ["tier", ["Expert", "Public", "Newbie"].includes(String(record.tier))],
    ["date", typeof record.date === "string"], ["sentiment", isScore(record.sentiment)], ["transcript", typeof record.transcript === "string"],
    ["language", ["en", "hi", "mixed"].includes(String(record.language))],
    ["topics", !!record.topics && [record.topics.UX, record.topics.Pricing, record.topics.Features].every(isScore)],
    ["keyPoints", Array.isArray(record.keyPoints) && record.keyPoints.every((point) => typeof point === "string")],
    ["sourceType", record.sourceType === undefined || ["audio", "images", "text"].includes(record.sourceType)],
    ["analysisEngine", record.analysisEngine === undefined || ["trata-rules", "multilingual-transformer", "lexical-fallback", "trata-engine"].includes(record.analysisEngine)],
    ["imageNames", record.imageNames === undefined || (Array.isArray(record.imageNames) && record.imageNames.every((name) => typeof name === "string"))],
    ["transcriptionStatus", record.transcriptionStatus === undefined || ["processing", "complete", "interrupted"].includes(record.transcriptionStatus)],
  ];
  const failed = checks.find(([, ok]) => !ok);
  if (failed) return `${failed[0]} is missing or invalid`;
  if (record.analysis !== undefined) { const problem = analysisProblem(record.analysis); if (problem) return `analysis: ${problem}`; }
  return null;
}

export const isValidInterview = (value: unknown): value is Interview => interviewProblem(value) === null;
