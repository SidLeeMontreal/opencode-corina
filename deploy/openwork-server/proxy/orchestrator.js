import { spawn } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "fs";
import { randomUUID } from "crypto";
import http from "http";
import path from "path";

const BASE_PORT = 9000;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || "50", 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || "1800000", 10);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/workspace";
const SESSIONS_DIR = process.env.SESSIONS_DIR || "/var/workspace/sessions";
const DATA_HOME = process.env.DATA_HOME || "/home/openwork/.local/share";
const DB_TEMPLATE_FILE = path.join(DATA_HOME, "opencode-db-template", "opencode.db");
const CONFIG_TEMPLATE = process.env.OPENCODE_CONFIG_TEMPLATE || path.join(WORKSPACE_DIR, "deploy/openwork-server/opencode.jsonc");

const sessions = new Map();
let nextPort = BASE_PORT;

mkdirSync(SESSIONS_DIR, { recursive: true });

function mirrorWorkspaceIntoSession(workDir) {
  for (const entry of readdirSync(WORKSPACE_DIR)) {
    if (entry === "opencode.jsonc" || entry === "opencode.json") {
      continue;
    }

    const src = path.join(WORKSPACE_DIR, entry);
    const dest = path.join(workDir, entry);
    if (existsSync(dest)) continue;

    try {
      symlinkSync(src, dest);
    } catch {}
  }

  if (existsSync(CONFIG_TEMPLATE)) {
    copyFileSync(CONFIG_TEMPLATE, path.join(workDir, "opencode.jsonc"));
  }
}

function spawnSession(sessionId) {
  const port = nextPort++;
  const workDir = path.join(SESSIONS_DIR, sessionId);
  const dataDir = path.join(DATA_HOME, "sessions", sessionId);

  mkdirSync(workDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mirrorWorkspaceIntoSession(workDir);

  const dbDir = path.join(dataDir, "opencode");
  if (existsSync(DB_TEMPLATE_FILE)) {
    mkdirSync(dbDir, { recursive: true });
    copyFileSync(DB_TEMPLATE_FILE, path.join(dbDir, "opencode.db"));
  }

  const child = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs"], {
    cwd: workDir,
    env: { ...process.env, XDG_DATA_HOME: dataDir, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => process.stdout.write(`[serve:${sessionId.slice(0, 8)}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[serve:${sessionId.slice(0, 8)}] ${d}`));
  child.on("exit", (code) => {
    console.log(`[orchestrator] session ${sessionId} exited with code ${code}`);
    sessions.delete(sessionId);
  });

  const session = { id: sessionId, port, process: child, lastActivity: Date.now(), workDir, dataDir, pinned: false };
  sessions.set(sessionId, session);
  return session;
}

function destroySession(sessionId) {
  const sess = sessions.get(sessionId);
  if (!sess) return;

  sess.process.kill("SIGTERM");
  sessions.delete(sessionId);

  sess.process.on("exit", () => {
    try {
      rmSync(sess.workDir, { recursive: true, force: true });
    } catch {}
    try {
      rmSync(sess.dataDir, { recursive: true, force: true });
    } catch {}
  });
}

function checkServeAlive(sess) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: sess.port, path: "/global/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

setInterval(async () => {
  const now = Date.now();
  for (const [id, sess] of sessions) {
    const alive = await checkServeAlive(sess);
    if (!alive) {
      destroySession(id);
      continue;
    }
    if (!sess.pinned && now - sess.lastActivity > IDLE_TIMEOUT_MS) {
      destroySession(id);
    }
  }
}, 30000);

const SESSION_READY_TIMEOUT_MS = parseInt(process.env.SESSION_READY_TIMEOUT_MS || "120000", 10);

async function waitForReady(port, timeoutMs = SESSION_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port, path: "/global/health", timeout: 1000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.end();
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function createSession() {
  if (sessions.size >= MAX_SESSIONS) {
    let oldest = null;
    for (const sess of sessions.values()) {
      if (!oldest || sess.lastActivity < oldest.lastActivity) {
        oldest = sess;
      }
    }
    if (oldest) destroySession(oldest.id);
  }

  const sessionId = randomUUID();
  const sess = spawnSession(sessionId);
  const ready = await waitForReady(sess.port);
  if (!ready) {
    destroySession(sessionId);
    throw new Error("Session failed to start");
  }
  return sess;
}

export function getSession(sessionId) {
  const sess = sessions.get(sessionId);
  if (!sess) return null;
  sess.lastActivity = Date.now();
  return sess;
}

export { destroySession };

export function isSessionAlive(sessionId) {
  const sess = sessions.get(sessionId);
  if (!sess) return false;
  return sess.process.exitCode === null && !sess.process.killed;
}

export function pinSession(sessionId) {
  const sess = sessions.get(sessionId);
  if (sess) sess.pinned = true;
}

export function getStats() {
  return {
    active: sessions.size,
    max: MAX_SESSIONS,
    idleTimeoutMinutes: IDLE_TIMEOUT_MS / 60000,
    sessions: [...sessions.values()].map((sess) => ({
      id: sess.id,
      port: sess.port,
      workDir: sess.workDir,
      pinned: sess.pinned,
      idleSeconds: Math.round((Date.now() - sess.lastActivity) / 1000),
    })),
  };
}
