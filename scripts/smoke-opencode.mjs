#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const EXPECTED_OPENCODE_VERSION = "1.15.3";

function log(message) {
  console.log(`[smoke:opencode] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function opencodeVersion() {
  return execFileSync("opencode", ["--version"], { encoding: "utf8" }).trim();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error("Could not allocate port"))));
    });
  });
}

async function getJson(baseUrl, path, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${path} returned ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${path} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth(baseUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await getJson(baseUrl, "/global/health");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("OpenCode server did not become healthy");
}

function writePermissionFixture(root) {
  mkdirSync(join(root, ".opencode", "agents"), { recursive: true });
  mkdirSync(join(root, ".opencode", "skills", "opencode-smoke"), { recursive: true });

  writeFileSync(
    join(root, "opencode.jsonc"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        default_agent: "corina",
        permission: {
          edit: "deny",
          bash: "deny",
          task: { "*": "deny", helper: "allow" },
          external_directory: "deny",
          webfetch: "ask",
          websearch: "ask",
          skill: { "*": "deny", "opencode-smoke": "allow" },
        },
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(root, ".opencode", "agents", "corina.md"),
    `---
description: Permission smoke primary agent
mode: primary
permission:
  edit: ask
  bash: deny
  webfetch: ask
  task:
    "*": deny
    helper: allow
  skill:
    "*": deny
    opencode-smoke: allow
---
Permission smoke primary agent.
`,
  );

  writeFileSync(
    join(root, ".opencode", "agents", "helper.md"),
    `---
description: Permission smoke helper
mode: subagent
hidden: true
permission:
  edit: deny
  bash: deny
  webfetch: deny
---
Permission smoke helper.
`,
  );

  writeFileSync(
    join(root, ".opencode", "skills", "opencode-smoke", "SKILL.md"),
    `---
name: opencode-smoke
description: Test skill for OpenCode permission smoke.
---
Run the OpenCode smoke test.
`,
  );
}

function permissionRules(agent) {
  return Array.isArray(agent?.permission) ? agent.permission : [];
}

function hasRule(agent, permission, pattern, action) {
  return permissionRules(agent).some(
    (rule) => rule.permission === permission && rule.pattern === pattern && rule.action === action,
  );
}

function agentsFromResponse(response) {
  return Array.isArray(response) ? response : Object.values(response);
}

function assertPermissionFixture({ health, config, agents }) {
  if (health.version !== EXPECTED_OPENCODE_VERSION) {
    fail(`Expected OpenCode ${EXPECTED_OPENCODE_VERSION}, got ${health.version}`);
  }

  const permission = config.permission ?? {};
  if (config.default_agent !== "corina") fail("OpenCode did not load default_agent=corina from fixture config");
  if (permission.edit !== "deny") fail("OpenCode did not expose top-level permission.edit=deny");
  if (permission.bash !== "deny") fail("OpenCode did not expose top-level permission.bash=deny");
  if (permission.external_directory !== "deny") {
    fail("OpenCode did not expose top-level permission.external_directory=deny");
  }
  if (permission.task?.["*"] !== "deny" || permission.task?.helper !== "allow") {
    fail("OpenCode did not expose top-level permission.task allowlist");
  }
  if (permission.skill?.["*"] !== "deny" || permission.skill?.["opencode-smoke"] !== "allow") {
    fail("OpenCode did not expose top-level permission.skill allowlist");
  }

  const allAgents = agentsFromResponse(agents);
  const corina = allAgents.find((agent) => agent.name === "corina");
  const helper = allAgents.find((agent) => agent.name === "helper");
  if (!corina) fail("OpenCode did not register fixture corina agent");
  if (!helper) fail("OpenCode did not register fixture helper subagent");

  if (!hasRule(corina, "edit", "*", "ask")) fail("OpenCode did not expose agent permission.edit=ask");
  if (!hasRule(corina, "bash", "*", "deny")) fail("OpenCode did not expose agent permission.bash=deny");
  if (!hasRule(corina, "task", "helper", "allow")) fail("OpenCode did not expose agent task allowlist");
  if (!hasRule(corina, "skill", "opencode-smoke", "allow")) fail("OpenCode did not expose agent skill allowlist");

  if (helper.mode !== "subagent") fail("OpenCode did not preserve helper mode=subagent");
  if (helper.hidden !== true) fail("OpenCode did not preserve helper hidden=true");
  if (!hasRule(helper, "edit", "*", "deny")) fail("OpenCode did not expose subagent permission.edit=deny");
  if (!hasRule(helper, "bash", "*", "deny")) fail("OpenCode did not expose subagent permission.bash=deny");
}

function assertRepoDiscovery({ health, tools, agents, mcp }) {
  if (health.version !== EXPECTED_OPENCODE_VERSION) {
    fail(`Expected OpenCode ${EXPECTED_OPENCODE_VERSION}, got ${health.version}`);
  }
  const expectedTools = ["draft", "tone", "detect", "critique", "concise"];
  for (const tool of expectedTools) {
    if (!tools.includes(tool)) fail(`OpenCode did not register tool '${tool}'`);
  }

  const allAgents = agentsFromResponse(agents);
  const corina = allAgents.find((agent) => agent.name === "corina");
  if (!corina) fail("OpenCode did not register Corina from repo .opencode/agents");
  if (corina.mode !== "primary") fail("Corina is not registered as a primary agent");
  if (mcp && Object.keys(mcp).length > 0) fail(`Unexpected MCP servers registered: ${Object.keys(mcp).join(", ")}`);
}

async function withOpencodeServer(cwd, callback) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs"], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    const health = await waitForHealth(baseUrl);
    return await callback({ baseUrl, health });
  } catch (error) {
    error.message = `${error.message}\n--- opencode output ---\n${output.slice(-4000)}`;
    throw error;
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  }
}

async function runPermissionFixtureSmoke() {
  const root = mkdtempSync(join(tmpdir(), "corina-opencode-permission-"));
  try {
    writePermissionFixture(root);
    await withOpencodeServer(root, async ({ baseUrl, health }) => {
      const [config, agents] = await Promise.all([getJson(baseUrl, "/config"), getJson(baseUrl, "/agent")]);
      assertPermissionFixture({ health, config, agents });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runRepoDiscoverySmoke() {
  await withOpencodeServer(process.cwd(), async ({ baseUrl, health }) => {
    const [tools, agents, mcp] = await Promise.all([
      getJson(baseUrl, "/experimental/tool/ids"),
      getJson(baseUrl, "/agent"),
      getJson(baseUrl, "/mcp"),
    ]);
    assertRepoDiscovery({ health, tools, agents, mcp });
  });
}

async function main() {
  const version = opencodeVersion();
  if (version !== EXPECTED_OPENCODE_VERSION) {
    fail(`Expected opencode ${EXPECTED_OPENCODE_VERSION} on PATH, got ${version}`);
  }

  log(`opencode ${version}`);
  await runPermissionFixtureSmoke();
  log("permission fixture accepted by OpenCode server");
  await runRepoDiscoverySmoke();
  log("repo agents/tools discovered by OpenCode server");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
