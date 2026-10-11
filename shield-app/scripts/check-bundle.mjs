// Fails if the production bundle contains the e2e-only camera stand-in.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["__shieldE2ECamera"];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const bad = walk("dist")
  .filter((f) => /\.(js|html|map)$/.test(f))
  .filter((f) => FORBIDDEN.some((t) => readFileSync(f, "utf8").includes(t)));

if (bad.length) {
  console.error(`e2e-only code found in the production bundle:\n${bad.join("\n")}`);
  process.exit(1);
}
console.log("production bundle is free of e2e-only code");
