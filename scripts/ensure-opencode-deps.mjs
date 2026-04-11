#!/usr/bin/env node
/**
 * Clones OpenCode helper repos into deps/ and builds them so file:deps/* resolves.
 * GitHub npm installs only pack the "files" whitelist (e.g. dist/), but dist is not
 * committed — full git clones are required.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const REPOS = [
  {
    dir: "opencode-model-resolver",
    url: "https://github.com/SidLeeMontreal/opencode-model-resolver.git",
    distMarker: ["dist", "index.js"],
  },
  {
    dir: "opencode-text-tools",
    url: "https://github.com/SidLeeMontreal/opencode-text-tools.git",
    distMarker: ["dist", "index.js"],
  },
  {
    dir: "opencode-eval-harness",
    url: "https://github.com/SidLeeMontreal/opencode-eval-harness.git",
    distMarker: ["dist", "src", "index.js"],
  },
];

function distReady(target, segments) {
  return existsSync(join(target, ...segments));
}

function main() {
  if (process.env["SKIP_OPENCODE_DEPS"] === "1") {
    return;
  }

  const depsRoot = join(root, "deps");
  mkdirSync(depsRoot, { recursive: true });

  for (const { dir, url, distMarker } of REPOS) {
    const target = join(depsRoot, dir);
    if (!existsSync(join(target, ".git"))) {
      console.log(`[opencode-corina] cloning ${dir}…`);
      execFileSync("git", ["clone", "--depth", "1", "--branch", "main", url, target], {
        stdio: "inherit",
      });
    }

    if (!distReady(target, distMarker)) {
      console.log(`[opencode-corina] npm install + build in ${dir}…`);
      execFileSync("npm", ["install"], { cwd: target, stdio: "inherit" });
      execFileSync("npm", ["run", "build"], { cwd: target, stdio: "inherit" });
    }
  }
}

main();
