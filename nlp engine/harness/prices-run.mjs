// Checks price extraction on prices-cases.mjs. Build first: node "nlp engine/harness/build.mjs"
//   node "nlp engine/harness/prices-run.mjs" [--verbose]
import { createRequire } from "node:module";
import { PRICE_CASES } from "./prices-cases.mjs";

const require = createRequire(import.meta.url);
const { analyzeWithRules } = require("../.build/lib/rules/index.js");
const verbose = process.argv.includes("--verbose");

const key = (p) => `${p.amount}|${p.period}|${p.stance}|${p.limit ?? ""}|${p.who}`;
let pass = 0;
for (const item of PRICE_CASES) {
  const got = (analyzeWithRules(item.text).prices ?? []).map(key).sort();
  const want = item.want.map(key).sort();
  const ok = got.length === want.length && got.every((g, i) => g === want[i]);
  if (ok) pass += 1;
  if (!ok || verbose) console.log(`${ok ? "PASS" : "FAIL"} ${item.id.padEnd(14)} want [${want.join(", ")}]\n${" ".repeat(20)}got  [${got.join(", ")}]`);
}
console.log(`\n${pass}/${PRICE_CASES.length} price cases passed`);
