// Does a small multilingual sentiment model beat the rules on the test calls?
// The model only gets the CUSTOMER's answers (its best case: no interviewer pitch, no accident talk from the interviewer).
// Score = P(positive) - P(negative), judged against the same bands as the rules.
//   node "nlp engine/model-test/model-vs-rules.mjs" [model-id]
// The model is downloaded from Hugging Face on the first run (cache: nlp engine/model-test/.cache, not committed).
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BANDS, CASES as TUNING } from "../harness/cases.mjs";
import { CASES as HOLDOUT } from "../harness/holdout.mjs";
import { CASES as HOLDOUT2 } from "../harness/holdout2.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "package.json"));
const { pipeline, env } = require("@huggingface/transformers");
env.cacheDir = path.join(here, ".cache");

const modelId = process.argv[2] ?? "Xenova/distilbert-base-multilingual-cased-sentiments-student";
const t0 = Date.now();
const classify = await pipeline("text-classification", modelId, { dtype: "q8" });
console.log(`loaded ${modelId} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const rulesLib = require(path.join(here, "../.build/lib/rules/index.js"));
const cases = [...TUNING, ...HOLDOUT, ...HOLDOUT2];
let modelPass = 0, rulesPass = 0, signOk = 0;
const rows = [];
const t1 = Date.now();
for (const item of cases) {
  const text = item.answers.join(" ");
  const out = await classify(text, { top_k: null });
  const p = Object.fromEntries(out.map((o) => [o.label.toLowerCase(), o.score]));
  const score = (p.positive ?? 0) - (p.negative ?? 0);
  const [lo, hi] = BANDS[item.expect];
  const pass = score >= lo && score <= hi;
  const rules = rulesLib.analyzeWithRules(item.text).ideaSentiment.score;
  const rpass = rules >= lo && rules <= hi;
  const wantSign = item.expect.startsWith("s") ? (item.expect === "sp" ? 1 : -1) : item.expect === "p" ? 1 : item.expect === "n" ? -1 : 0;
  if (wantSign === 0 || Math.sign(score) === wantSign) signOk += 1;
  if (pass) modelPass += 1;
  if (rpass) rulesPass += 1;
  rows.push({ id: item.id, expect: item.expect, model: Math.round(score * 1000) / 1000, rules, modelPass: pass, rulesPass: rpass });
  console.log(`${pass ? "ok  " : "MISS"} ${item.id.padEnd(14)} want ${item.expect.padEnd(3)} model ${score.toFixed(3).padStart(6)}   rules ${rules.toFixed(3).padStart(6)}`);
}
const ms = (Date.now() - t1) / cases.length;
console.log(`\nmodel: ${modelPass}/${cases.length} in band, ${signOk}/${cases.length} right direction   rules: ${rulesPass}/${cases.length} in band   (${ms.toFixed(0)} ms per call on CPU)`);
let bytes = 0;
(function walk(dir) { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else bytes += fs.statSync(f).size; } })(env.cacheDir);
console.log(`model files on disk: ${(bytes / 1e6).toFixed(0)} MB`);
fs.writeFileSync(path.join(here, `../results/06-model-${modelId.split("/").pop()}.json`), JSON.stringify({ modelId, modelPass, rulesPass, signOk, total: cases.length, msPerCall: ms, modelMB: bytes / 1e6, rows }, null, 2));
