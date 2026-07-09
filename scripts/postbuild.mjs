/**
 * Post-build step: runs tsc-alias, then reverts any bare module specifiers
 * that tsc-alias incorrectly resolved (e.g. `mqtt` npm package import).
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// 1. Run tsc-alias
execSync("npx tsc-alias -p tsconfig.json", { stdio: "inherit" });

// 2. Revert bare specifier `mqtt` that tsc-alias rewrites to `../mqtt`
const fixFiles = [
  "dist/mqtt/client.js",
  "dist/mqtt/basic-client.js",
  "dist/mqtt/client.d.ts",
  "dist/mqtt/basic-client.d.ts",
];

for (const f of fixFiles) {
  if (!existsSync(f)) continue;
  const content = readFileSync(f, "utf8");
  const fixed = content.replace(/from\s+["']\.\.\/mqtt["']/g, 'from "mqtt"');
  if (fixed !== content) {
    writeFileSync(f, fixed, "utf8");
  }
}
