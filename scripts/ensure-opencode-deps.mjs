#!/usr/bin/env node
/**
 * Clones OpenCode helper repos into deps/ and builds them so file:deps/* resolves.
 * GitHub npm installs only pack the "files" whitelist (e.g. dist/), but dist is not
 * committed — full git clones are required.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const depsLock = JSON.parse(readFileSync(join(root, "deps.lock.json"), "utf8"));

const REPOS = [
  {
    dir: "opencode-model-resolver",
    distMarker: ["dist", "index.js"],
  },
  {
    dir: "opencode-text-tools",
    distMarker: ["dist", "index.js"],
  },
  {
    dir: "opencode-eval-harness",
    distMarker: ["dist", "src", "index.js"],
  },
].map((repo) => {
  const locked = depsLock.repositories?.[repo.dir];
  if (!locked?.url || !locked?.commit) {
    throw new Error(`Missing dependency pin for ${repo.dir} in deps.lock.json`);
  }
  return { ...repo, url: locked.url, commit: locked.commit };
});

function distReady(target, segments) {
  return existsSync(join(target, ...segments));
}

function git(cwd, args, options = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", ...options }).trim();
}

function currentCommit(target) {
  return git(target, ["rev-parse", "HEAD"]);
}

function ensurePinnedCheckout({ dir, url, commit }, target) {
  if (!existsSync(join(target, ".git"))) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
    console.log(`[opencode-corina] cloning ${dir} at ${commit}`);
    execFileSync("git", ["clone", url, target], { stdio: "inherit" });
  }

  if (currentCommit(target) !== commit) {
    console.log(`[opencode-corina] checking out ${dir} at ${commit}`);
    execFileSync("git", ["fetch", "origin", commit], { cwd: target, stdio: "inherit" });
    execFileSync("git", ["checkout", "--detach", commit], { cwd: target, stdio: "inherit" });
  }

  const actual = currentCommit(target);
  if (actual !== commit) {
    throw new Error(`Dependency ${dir} checkout mismatch: expected ${commit}, got ${actual}`);
  }
  console.log(`[opencode-corina] ${dir} pinned at ${actual}`);
}

function main() {
  if (process.env["SKIP_OPENCODE_DEPS"] === "1") {
    return;
  }

  const depsRoot = join(root, "deps");
  mkdirSync(depsRoot, { recursive: true });

  for (const repo of REPOS) {
    const { dir, distMarker } = repo;
    const target = join(depsRoot, dir);
    ensurePinnedCheckout(repo, target);

    if (!distReady(target, distMarker)) {
      console.log(`[opencode-corina] npm install + build in ${dir}`);
      execFileSync("npm", ["install"], { cwd: target, stdio: "inherit" });
      execFileSync("npm", ["run", "build"], { cwd: target, stdio: "inherit" });
    }
  }
}

main();
