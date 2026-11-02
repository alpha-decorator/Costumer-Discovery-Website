// Score one transcript file with the current rules (and the old ones if built): node "nlp engine/harness/check.mjs" <file> [--old]
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dir = process.argv.includes("--old") ? "../.build-HEAD" : "../.build";
const { analyzeWithRules } = require(`${dir}/lib/rules/index.js`);
const { buildDoc } = require(`${dir}/lib/rules/extract.js`);
const { stripTimestamps } = require(`${dir}/lib/rules/analyze.js`);
const text = fs.readFileSync(process.argv[2], "utf8");
const r = analyzeWithRules(text);
const doc = buildDoc(stripTimestamps(text));
console.log({ score: r.ideaSentiment.score, label: r.ideaSentiment.label, verdict: r.verdict, wouldUse: r.wouldUse, wouldPay: r.wouldPay, reasons: r.flags.reasons, speakers: doc.mode });
console.log("units:", doc.units.map((u) => `${u.kind}:${u.text.slice(0, 50)}`).join("\n       "));
console.log("cues:", doc.cues.map((c) => `${c.text}(${c.value.toFixed(2)})`).join(" "));
