// Prints how one test call is split and read: node "nlp engine/harness/debug-call.mjs" <case-id> (price, long or tuning case ids)
import { createRequire } from "node:module";
import { PRICE_CASES } from "./prices-cases.mjs";
import { CASES } from "./cases.mjs";
const require = createRequire(import.meta.url);
const { buildDoc } = require("../.build/lib/rules/extract.js");
const { analyzeWithRules } = require("../.build/lib/rules/index.js");
for (const id of process.argv.slice(2)) {
  const c = [...PRICE_CASES, ...CASES].find((x) => x.id === id);
  const d = buildDoc(c.text);
  console.log(id, "introAt", d.introAt, "\n " + d.units.map((u, i) => `${i} ${u.kind}: ${u.n.slice(0, 70)}`).join("\n "));
  const r = analyzeWithRules(c.text);
  console.log(" flags", r.flags.reasons, "wouldPay", r.wouldPay, "prices", JSON.stringify(r.prices ?? []));
}
