// Lists every INV-xx in docs/INVARIANTS.md that no test mentions.
// Usage: node scripts/check-invariant-coverage.mjs [--strict]
// --strict exits non-zero if any invariant is untested (enabled in CI before submission).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ids = [...new Set(readFileSync("docs/INVARIANTS.md", "utf8").match(/^### (INV-\d+)/gm).map((h) => h.slice(4)))];

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/(\.test\.ts|test_.*\.py)$/.test(name)) out.push(p);
  }
  return out;
}

const corpus = files(".").map((f) => readFileSync(f, "utf8")).join("\n");
const missing = ids.filter((id) => !new RegExp(`(?<![A-Za-z0-9])${id.replace("-", "-?")}(?!\\d)`).test(corpus));

console.log(`Invariants: ${ids.length}, tested: ${ids.length - missing.length}`);
if (missing.length) console.log(`Not yet tested: ${missing.join(", ")}`);
if (missing.length && process.argv.includes("--strict")) process.exit(1);
