// Runs every test call through the website's analyser and checks the score band.
//   node "nlp engine/harness/build.mjs" && node "nlp engine/harness/run.mjs" [--set tuning|holdout|holdout2|long|all] [--old] [--verbose] [--json out.json] [--only id-prefix]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { BANDS, CASES as TUNING } from "./cases.mjs";
import { CASES as HOLDOUT } from "./holdout.mjs";
import { CASES as HOLDOUT2 } from "./holdout2.mjs";
import { CASES as LONG, LONG_BANDS } from "./long.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
// --old: run the rules as they were before this pass (built with: build.mjs --git HEAD)
const dir = args.includes("--old") ? "../.build-HEAD" : "../.build";
const { analyzeWithRules } = require(`${dir}/lib/rules/index.js`);
const { buildDoc } = require(`${dir}/lib/rules/extract.js`);
const { stripTimestamps } = require(`${dir}/lib/rules/analyze.js`);

const verbose = args.includes("--verbose");
const jsonAt = args.indexOf("--json");
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1] : "";
const setAt = args.indexOf("--set");
const set = setAt >= 0 ? args[setAt + 1] : "tuning";
const CASES = set === "holdout" ? HOLDOUT : set === "holdout2" ? HOLDOUT2 : set === "long" ? LONG : set === "all" ? [...TUNING, ...HOLDOUT, ...HOLDOUT2, ...LONG] : TUNING;
Object.assign(BANDS, LONG_BANDS);

const rows = [];
for (const item of CASES.filter((x) => !only || x.id.startsWith(only))) {
  const result = analyzeWithRules(item.text);
  const score = result.ideaSentiment.score;
  const [lo, hi] = BANDS[item.expect];
  const pass = result.ideaSentiment.label !== "not_discussed" && score >= lo && score <= hi;
  const doc = buildDoc(stripTimestamps(item.text));
  const cues = doc.cues.map((cue) => `${cue.text}(${cue.value > 0 ? "+" : ""}${cue.value.toFixed(2)})`);
  rows.push({ id: item.id, expect: item.expect, score, label: result.ideaSentiment.label, verdict: result.verdict, wouldUse: result.wouldUse, wouldPay: result.wouldPay, pass, cues, note: item.note });
}

const pad = (s, n) => String(s).padEnd(n);
let passed = 0;
for (const row of rows) {
  if (row.pass) passed += 1;
  if (verbose || !row.pass) {
    console.log(`${row.pass ? "PASS" : "FAIL"} ${pad(row.id, 12)} want ${pad(row.expect, 3)} got ${pad(row.score.toFixed(3), 7)} ${pad(row.label, 16)} use=${pad(row.wouldUse, 7)} pay=${pad(row.wouldPay, 7)} | ${row.cues.join(" ")}`);
  }
}
const byBand = {};
for (const row of rows) { byBand[row.expect] ??= [0, 0]; byBand[row.expect][1] += 1; if (row.pass) byBand[row.expect][0] += 1; }
console.log(`\n${passed}/${rows.length} passed  ${Object.entries(byBand).map(([k, [a, b]]) => `${k}:${a}/${b}`).join("  ")}`);
const mae = rows.reduce((sum, row) => { const [lo, hi] = BANDS[row.expect]; return sum + (row.score < lo ? lo - row.score : row.score > hi ? row.score - hi : 0); }, 0) / rows.length;
console.log(`mean distance outside band: ${mae.toFixed(3)}`);
if (jsonAt >= 0) fs.writeFileSync(path.resolve(args[jsonAt + 1]), JSON.stringify(rows, null, 2));
