// Transpiles the website's analyser (src/lib/**/*.ts) into plain CommonJS under nlp engine/.build so Node can run it
// without Next.js. "@/x" imports are rewritten to relative paths. Run: node "nlp engine/harness/build.mjs"
//   --git <rev>  build the files as they are in git at <rev> (for example HEAD = the rules before this pass) into .build-<rev>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const gitAt = process.argv.indexOf("--git");
const rev = gitAt >= 0 ? process.argv[gitAt + 1] : "";
const out = path.resolve(here, rev ? `../.build-${rev.replace(/[^\w-]/g, "_")}` : "../.build");
const readSource = (file) => rev
  ? execFileSync("git", ["show", `${rev}:${path.relative(root, file).split(path.sep).join("/")}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 })
  : fs.readFileSync(file, "utf8");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

const srcDir = path.join(root, "src");
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.ts$/.test(entry.name) && full.includes(`${path.sep}lib${path.sep}`)) files.push(full);
  }
})(srcDir);

fs.rmSync(out, { recursive: true, force: true });
for (const file of files) {
  const rel = path.relative(srcDir, file);
  const target = path.join(out, rel.replace(/\.ts$/, ".js"));
  let code;
  try { code = readSource(file); } catch { continue; } // a file that did not exist at that revision
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  });
  const fixed = outputText.replace(/require\("@\/([^"]+)"\)/g, (_, spec) => {
    let r = path.relative(path.dirname(target), path.join(out, spec)).split(path.sep).join("/");
    if (!r.startsWith(".")) r = `./${r}`;
    return `require("${r}")`;
  });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, fixed);
}
// JSON imports (india-outline.json) are copied as is.
for (const json of ["lib/india-outline.json"]) {
  const from = path.join(srcDir, json);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(out, json));
}
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ type: "commonjs" }));
console.log(`built ${files.length} files into ${path.relative(root, out)}`);
