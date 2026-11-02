// Old rules (git HEAD) vs new rules (working tree) on the real calls in the repo: interviews.csv and the engine's saved
// transcripts. Prints each call's score, label and verdict before and after.
//   node "nlp engine/harness/build.mjs" && node "nlp engine/harness/build.mjs" --git HEAD && node "nlp engine/harness/regress.mjs"
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(import.meta.url);
const NEW = require("../.build/lib/rules/index.js");
const OLD = require("../.build-HEAD/lib/rules/index.js");

function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.replace(/^﻿/, "").replace(/"/g, ""));
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const calls = [];
const csvPath = path.join(root, "interviews.csv");
if (fs.existsSync(csvPath)) for (const row of parseCsv(fs.readFileSync(csvPath, "utf8"))) calls.push({ id: `csv:${row.name}`, text: row.transcript });
const tdir = path.join(root, "engine/data/transcripts");
if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir)) {
  const j = JSON.parse(fs.readFileSync(path.join(tdir, f), "utf8"));
  const text = j.text ?? j.transcript ?? (Array.isArray(j.segments) ? j.segments.map((s) => s.text).join("\n") : "");
  if (text) calls.push({ id: `engine:${f.slice(0, 8)}`, text });
}

for (const c of calls) {
  const a = OLD.analyzeWithRules(c.text).ideaSentiment; const b = NEW.analyzeWithRules(c.text).ideaSentiment;
  const va = OLD.analyzeWithRules(c.text).verdict; const vb = NEW.analyzeWithRules(c.text).verdict;
  console.log(`${c.id.padEnd(20)} old ${a.score.toFixed(3).padStart(6)} ${a.label.padEnd(15)} ${va.padEnd(10)} -> new ${b.score.toFixed(3).padStart(6)} ${b.label.padEnd(15)} ${vb}`);
}
