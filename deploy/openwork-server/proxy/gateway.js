import http from "http";
import { createSession, getSession, destroySession, pinSession, getStats, isSessionAlive } from "./orchestrator.js";

const GATEWAY_PORT = parseInt(process.env.GATEWAY_OPENCODE_PORT || "3001", 10);
const PROXY_API_KEY = process.env.PROXY_API_KEY || "";
const COOKIE_NAME = "openwork_session";

function extractToken(req) {
  const auth = req.headers.authorization;
  if (!auth) return "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString();
      return decoded.includes(":") ? decoded.split(":").slice(1).join(":") : decoded;
    } catch {
      return "";
    }
  }
  return "";
}

function isAuthenticated(req) {
  if (!PROXY_API_KEY) return true;
  return extractToken(req) === PROXY_API_KEY;
}

function denyHttp(res) {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "Invalid or missing API key", type: "auth_error" } }));
}

const ipBindings = new Map();
const userBindings = new Map();
const ipLocks = new Map();
const activeWebSockets = new Set();

function clientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.socket.remoteAddress
    || "unknown";
}

function parseCookie(req) {
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match?.[1] || null;
}

function sessionCookie(id) {
  return `${COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

async function resolveSession(req, forWebSocket = false, { clientId } = {}) {
  if (clientId) {
    const boundId = userBindings.get(clientId);
    if (boundId) {
      const existing = getSession(boundId);
      if (existing && isSessionAlive(boundId)) {
        return { sess: existing, isNew: false };
      }
      userBindings.delete(clientId);
      destroySession(boundId);
    }

    const lockKey = `user:${clientId}`;
    const pending = ipLocks.get(lockKey);
    if (pending) return { sess: await pending, isNew: false };

    const promise = createSession();
    ipLocks.set(lockKey, promise);
    try {
      const sess = await promise;
      userBindings.set(clientId, sess.id);
      return { sess, isNew: true };
    } finally {
      ipLocks.delete(lockKey);
    }
  }

  const cookieId = parseCookie(req);
  if (cookieId) {
    const existing = getSession(cookieId);
    if (existing && isSessionAlive(cookieId) && !(forWebSocket && activeWebSockets.has(existing.id))) {
      return { sess: existing, isNew: false };
    }
    destroySession(cookieId);
  }

  const ip = clientIp(req);
  const boundId = ipBindings.get(ip);
  if (boundId) {
    const existing = getSession(boundId);
    if (existing && isSessionAlive(boundId) && !(forWebSocket && activeWebSockets.has(existing.id))) {
      return { sess: existing, isNew: false };
    }
    ipBindings.delete(ip);
    destroySession(boundId);
  }

  const lockKey = forWebSocket ? `ws:${ip}:${Date.now()}` : ip;
  const pending = ipLocks.get(lockKey);
  if (pending) return { sess: await pending, isNew: false };

  const promise = createSession();
  ipLocks.set(lockKey, promise);
  try {
    const sess = await promise;
    ipBindings.set(ip, sess.id);
    return { sess, isNew: true };
  } finally {
    ipLocks.delete(lockKey);
  }
}

function proxyTo(req, res, port, extraHeaders = {}) {
  const headers = { ...req.headers, ...extraHeaders };
  delete headers.authorization;

  const proxyReq = http.request(
    { host: "127.0.0.1", port, path: req.url, method: req.method, headers },
    (proxyRes) => {
      const resHeaders = { ...proxyRes.headers, ...extraHeaders };
      res.writeHead(proxyRes.statusCode, resHeaders);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "upstream_error", message: err.message }));
  });

  req.pipe(proxyReq, { end: true });
}

function handleApi(req, res) {
  if (req.method === "POST" && req.url === "/_sessions") {
    req.resume();
    req.on("end", async () => {
      try {
        const sess = await createSession();
        const ip = clientIp(req);
        ipBindings.set(ip, sess.id);
        res.writeHead(201, { "Content-Type": "application/json", "Set-Cookie": sessionCookie(sess.id) });
        res.end(JSON.stringify({ id: sess.id, port: sess.port, workDir: sess.workDir }));
      } catch (err) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  const sessionMatch = req.url.match(/^\/_sessions\/([0-9a-f-]+)(\/pin)?$/);
  if (sessionMatch) {
    const id = sessionMatch[1];
    const isPin = sessionMatch[2] === "/pin";

    if (!getSession(id)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return true;
    }

    if (req.method === "DELETE" && !isPin) {
      destroySession(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ deleted: true }));
      return true;
    }

    if (req.method === "POST" && isPin) {
      pinSession(id);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ pinned: true }));
      return true;
    }
  }

  if (req.method === "GET" && req.url === "/_stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getStats()));
    return true;
  }

  if (req.method === "GET" && req.url === "/_health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, timestamp: new Date().toISOString() }));
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  if (handleApi(req, res)) return;

  if (!isAuthenticated(req)) return denyHttp(res);

  try {
    const { sess, isNew } = await resolveSession(req);
    const extra = { "x-session-id": sess.id };
    if (isNew) extra["Set-Cookie"] = sessionCookie(sess.id);
    proxyTo(req, res, sess.port, extra);
  } catch (err) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.on("upgrade", async (req, socket) => {
  if (!isAuthenticated(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  try {
    const { sess } = await resolveSession(req, true);
    const headers = { ...req.headers };
    delete headers.authorization;

    activeWebSockets.add(sess.id);

    const proxyReq = http.request({
      host: "127.0.0.1",
      port: sess.port,
      path: req.url,
      method: req.method,
      headers,
    });

    proxyReq.on("upgrade", (proxyRes, proxySocket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n"
        + Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")
        + "\r\n\r\n",
      );
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);

      const cleanup = () => {
        activeWebSockets.delete(sess.id);
      };
      socket.on("close", cleanup);
      proxySocket.on("close", cleanup);
    });

    proxyReq.on("error", () => socket.destroy());
    proxyReq.end();
  } catch {
    socket.destroy();
  }
});

server.listen(GATEWAY_PORT, "0.0.0.0", () => {
  console.log(`[gateway] listening on :${GATEWAY_PORT}`);
});

export async function resolveSessionForRequest(req, options = {}) {
  return resolveSession(req, false, options);
}
