// Renders the customer insights panel and the PDF report for the sample calls to static HTML, without signing in, so
// they can be looked at in a browser or screenshotted with headless Edge.
//   node "nlp engine/harness/preview.mjs"   -> nlp engine/results/preview-*.html
// It transpiles src/lib and src/components (TS + TSX) into nlp engine/.build-ui and server-renders them with React.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.resolve(here, "../.build-ui");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const srcDir = path.join(root, "src");

fs.rmSync(out, { recursive: true, force: true });
for (const sub of ["lib", "components"]) (function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(entry.name)) { if (entry.name.endsWith(".json")) { const t = path.join(out, path.relative(srcDir, full)); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.copyFileSync(full, t); } continue; }
    const target = path.join(out, path.relative(srcDir, full).replace(/\.tsx?$/, ".js"));
    const { outputText } = ts.transpileModule(fs.readFileSync(full, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
      fileName: full,
    });
    const fixed = outputText.replace(/require\("@\/([^"]+)"\)/g, (_, spec) => {
      let r = path.relative(path.dirname(target), path.join(out, spec)).split(path.sep).join("/");
      if (!r.startsWith(".")) r = `./${r}`;
      return `require("${r}")`;
    }).replace(/require\("[^"]+\.css"\);?/g, "");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fixed);
  }
})(path.join(srcDir, sub));
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ type: "commonjs" }));

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const local = createRequire(path.join(out, "package.json"));
const { I18nProvider } = local("./components/I18nProvider.js");
const { DetailedReport } = local("./components/DetailedReport.js");
const { CustomerInsightsView } = local("./components/CustomerInsights.js");
const { analyzeNotesWithRules } = local("./lib/nlp-analysis.js");

const samples = path.resolve(here, "../samples");
const people = [["Ravi Kumar", "Expert"], ["Anita Sharma", "Public"], ["Suresh Yadav", "Public"], ["Meena Gupta", "Newbie"], ["Arjun Mehta", "Expert"]];
const customers = fs.readdirSync(samples).filter((name) => name.endsWith(".txt")).sort().map((file, index) => {
  const transcript = fs.readFileSync(path.join(samples, file), "utf8");
  const read = analyzeNotesWithRules(transcript, { lang: /-hi\./.test(file) ? "hi" : "en", meta: { asrEngine: "text", asrModel: "", warnings: [] } });
  const [name, tier] = people[index % people.length];
  return { id: `C-${101 + index}`, name, initials: name.split(" ").map((part) => part[0]).join(""), company: "Independent", tier, date: `2026-10-${10 + index}`, city: "Delhi",
    sentiment: read.sentiment, topics: read.topics, keyPoints: read.keyPoints, transcript, language: read.language, sourceType: "text", analysis: read.analysis, analysisEngine: read.analysisEngine, demographics: {} };
});

const css = ["globals.css", "dashboard.css", "premium.css", "themes.css", "insights.css"].map((name) => fs.readFileSync(path.join(srcDir, "app", name), "utf8")).join("\n");
const page = (title, body, extraCss = "") => `<!doctype html><html lang="en" data-palette="royal"><head><meta charset="utf-8"><title>${title}</title><style>${css}\n${extraCss}</style></head><body class="fn-app" data-theme="light">${body}</body></html>`;
const wrap = (node) => renderToStaticMarkup(React.createElement(I18nProvider, { initialLang: "en" }, node));
const results = path.resolve(here, "../results");

const focus = customers.find((item) => item.analysis?.prices?.length) ?? customers[0];
const write = (name, html) => { fs.writeFileSync(path.join(results, name), html); console.log(`wrote nlp engine/results/${name}`); };
const staticReport = ".report-overlay{position:static!important;overflow:visible!important;background:#eef0ec!important;padding:20px}";
write("preview-pdf-customer.html", page("customer report", wrap(React.createElement(DetailedReport, { scope: { kind: "customer", title: focus.name, customers, customer: focus }, onClose: () => {} })), staticReport));
write("preview-pdf-group.html", page("group report", wrap(React.createElement(DetailedReport, { scope: { kind: "overall", title: "All customers", customers }, onClose: () => {} })), staticReport));
write("preview-panel.html", page("customer panel", `<div style="padding:24px;max-width:900px;margin:auto"><section class="detail-modal fn-detail" style="position:static;max-height:none">${wrap(React.createElement("section", { className: "fn-detail-insights" }, React.createElement("span", { className: "eyebrow" }, "What we learned from this call"), React.createElement(CustomerInsightsView, { analysis: focus.analysis, lang: "en" })))}</section></div>`));
