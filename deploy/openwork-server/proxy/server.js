import express from "express";
import http from "http";
import https from "https";
import { randomUUID } from "crypto";
import { resolveSessionForRequest } from "./gateway.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const PROXY_PORT = parseInt(process.env.PROXY_PORT || "3000", 10);
const PROXY_API_KEY = process.env.PROXY_API_KEY || "";
const DEFAULT_MODEL_ID = "corina";
const POLL_TIMEOUT_MS = 300000;

const FOUNDRY_BASE_URL = process.env.MICROSOFT_FOUNDRY_BASE_URL || "";
const FOUNDRY_API_KEY = process.env.MICROSOFT_FOUNDRY_API_KEY || "";
const FOUNDRY_API_VERSION = process.env.MICROSOFT_FOUNDRY_API_VERSION || "2024-10-21";

function serveRequest(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

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

function authenticateRequest(req, res, next) {
  if (!PROXY_API_KEY) return next();
  if (extractToken(req) !== PROXY_API_KEY) {
    return res.status(401).json({ error: { message: "Invalid or missing API key", type: "auth_error" } });
  }
  next();
}

async function waitForCompletion(port, sessionID) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout"));
    }, POLL_TIMEOUT_MS);
    let fullText = "";
    const reasoningPartIDs = new Set();

    const sseReq = http.request(
      { host: "127.0.0.1", port, path: "/global/event", method: "GET", headers: { Accept: "text/event-stream" } },
      (res) => {
        let buf = "";
        res.on("data", (c) => {
          buf += c.toString();
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              const type = evt.payload?.type;
              const props = evt.payload?.properties || {};

              if (type === "message.part.updated" && props.part?.sessionID === sessionID && props.part?.type === "reasoning") {
                reasoningPartIDs.add(props.part.id);
              }

              if (type === "message.part.delta" && props.sessionID === sessionID && props.field === "text") {
                if (!reasoningPartIDs.has(props.partID)) {
                  fullText += props.delta;
                }
              }

              if (type === "session.idle" && props.sessionID === sessionID) {
                cleanup();
                resolve(fullText);
              }
            } catch {}
          }
        });
      },
    );
    sseReq.on("error", () => {});
    sseReq.end();

    function cleanup() {
      clearTimeout(deadline);
      sseReq.destroy();
    }
  });
}

if (FOUNDRY_BASE_URL && FOUNDRY_API_KEY) {
  app.all(/^\/foundry\/(.*)/, (req, res) => {
    const sdkPath = `/${req.params[0]}`;
    const model = req.body?.model || "";
    const deploymentPath = model ? `/deployments/${model}${sdkPath}` : sdkPath;
    const target = new URL(FOUNDRY_BASE_URL);
    target.pathname = target.pathname.replace(/\/+$/, "") + deploymentPath;
    target.searchParams.set("api-version", FOUNDRY_API_VERSION);

    const body = req.method !== "GET" ? JSON.stringify(req.body) : null;
    const opts = {
      method: req.method,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      headers: {
        "Content-Type": "application/json",
        "api-key": FOUNDRY_API_KEY,
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
    };

    const upstream = https.request(opts, (upRes) => {
      res.status(upRes.statusCode);
      ["content-type", "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens"].forEach((h) => {
        if (upRes.headers[h]) res.setHeader(h, upRes.headers[h]);
      });
      upRes.pipe(res);
    });
    upstream.on("error", (e) => {
      res.status(502).json({ error: { message: e.message, type: "upstream_error" } });
    });
    if (body) upstream.write(body);
    upstream.end();
  });
}

const AZURE_RESOURCE_NAME = process.env.AZURE_RESOURCE_NAME || "";
const AZURE_API_KEY = process.env.AZURE_API_KEY || "";
const AZURE_API_VERSION = process.env.AZURE_API_VERSION || "2024-10-21";
if (AZURE_RESOURCE_NAME && AZURE_API_KEY) {
  const azureOpenAIBase = `https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/openai`;

  app.all(/^\/azure-opensource\/(.*)/, (req, res) => {
    const sdkPath = `/${req.params[0]}`;
    const model = req.body?.model || "";
    const deploymentPath = model ? `/deployments/${model}${sdkPath}` : sdkPath;
    const target = new URL(azureOpenAIBase);
    target.pathname = target.pathname.replace(/\/+$/, "") + deploymentPath;
    target.searchParams.set("api-version", AZURE_API_VERSION);

    const body = req.method !== "GET" ? JSON.stringify(req.body) : null;
    const opts = {
      method: req.method,
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      headers: {
        "Content-Type": "application/json",
        "api-key": AZURE_API_KEY,
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
    };

    const upstream = https.request(opts, (upRes) => {
      res.status(upRes.statusCode);
      ["content-type", "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens"].forEach((h) => {
        if (upRes.headers[h]) res.setHeader(h, upRes.headers[h]);
      });
      upRes.pipe(res);
    });
    upstream.on("error", (e) => {
      res.status(502).json({ error: { message: e.message, type: "upstream_error" } });
    });
    if (body) upstream.write(body);
    upstream.end();
  });
}

app.use(authenticateRequest);

app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: DEFAULT_MODEL_ID,
        object: "model",
        created: 0,
        owned_by: "corina",
      },
    ],
  });
});

function messageContent(msg) {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
  }
  return String(msg.content || "");
}

function buildConversationPrompt(messages) {
  if (!messages?.length) return "";
  if (messages.length === 1) return messageContent(messages[0]);

  const parts = [];
  for (const msg of messages) {
    const text = messageContent(msg);
    if (!text) continue;
    if (msg.role === "system") {
      parts.push(`[System]\n${text}`);
    } else if (msg.role === "assistant") {
      parts.push(`[Assistant]\n${text}`);
    } else {
      parts.push(`[User]\n${text}`);
    }
  }
  return parts.join("\n\n");
}

app.post("/v1/chat/completions", async (req, res) => {
  const { messages, model, user, stream = false } = req.body;
  const requestId = `chatcmpl-${randomUUID()}`;
  const modelId = model || DEFAULT_MODEL_ID;

  const prompt = buildConversationPrompt(messages);
  if (!prompt) {
    return res.status(400).json({ error: { message: "No user message found", type: "invalid_request_error" } });
  }

  try {
    const clientId = req.headers["x-openwebui-user-id"] || user || undefined;
    const { sess, isNew } = await resolveSessionForRequest(req, { clientId });
    const port = sess.port;

    const { data: ocSession } = await serveRequest(port, "POST", "/session", {});
    const ocSessionID = ocSession?.id;
    if (!ocSessionID) {
      throw new Error("Failed to create opencode session");
    }

    const promptRes = await serveRequest(port, "POST", `/session/${ocSessionID}/prompt_async`, {
      parts: [{ type: "text", text: prompt }],
    });

    if (promptRes.status !== 204) {
      throw new Error(`Prompt rejected: ${JSON.stringify(promptRes.data)}`);
    }

    const cookieHeader = isNew ? { "Set-Cookie": `openwork_session=${sess.id}; Path=/; HttpOnly; SameSite=Lax` } : {};
    const sessionHeaders = { "x-session-id": sess.id, "x-session-workspace": sess.workDir, ...cookieHeader };

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      Object.entries(sessionHeaders).forEach(([k, v]) => res.setHeader(k, v));
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      let roleSent = false;
      let clientClosed = false;
      res.on("close", () => {
        clientClosed = true;
      });

      const writeChunk = (content, finishReason = null) => {
        const delta = {};
        if (!roleSent) {
          delta.role = "assistant";
          roleSent = true;
        }
        if (content) delta.content = content;
        const chunk = {
          id: requestId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        if (typeof res.flush === "function") res.flush();
      };

      writeChunk("", null);

      const sseReq = http.request(
        { host: "127.0.0.1", port, path: "/global/event", method: "GET", headers: { Accept: "text/event-stream" } },
        (sseRes) => {
          let buf = "";
          const reasoningPartIDs = new Set();
          sseRes.on("data", (c) => {
            if (clientClosed) {
              sseReq.destroy();
              return;
            }
            buf += c.toString();
            const lines = buf.split("\n");
            buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const evt = JSON.parse(line.slice(6));
                const type = evt.payload?.type;
                const props = evt.payload?.properties || {};
                if (type === "message.part.updated" && props.part?.sessionID === ocSessionID && props.part?.type === "reasoning") {
                  reasoningPartIDs.add(props.part.id);
                }
                if (type === "message.part.delta" && props.sessionID === ocSessionID && props.field === "text" && !reasoningPartIDs.has(props.partID)) {
                  writeChunk(props.delta, null);
                }
                if (type === "session.idle" && props.sessionID === ocSessionID) {
                  writeChunk(null, "stop");
                  res.write("data: [DONE]\n\n");
                  res.end();
                  sseReq.destroy();
                }
              } catch {}
            }
          });
        },
      );
      sseReq.on("error", () => {
        if (!clientClosed) {
          res.end();
        }
      });
      sseReq.end();
      return;
    }

    const responseText = await waitForCompletion(port, ocSessionID);
    Object.entries(sessionHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.json({
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (error) {
    res.status(500).json({ error: { message: String(error), type: "internal_error" } });
  }
});

app.listen(PROXY_PORT, "0.0.0.0", () => {
  console.log(`[proxy] listening on :${PROXY_PORT}`);
});
