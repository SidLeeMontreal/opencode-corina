#!/bin/bash
set -euo pipefail

SOURCE_WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
RUNTIME_WORKSPACE_DIR="${RUNTIME_WORKSPACE_DIR:-/var/workspace/runtime}"
WORKSPACE_DIR="${RUNTIME_WORKSPACE_DIR}"
DEPLOY_DIR="${WORKSPACE_DIR}/deploy/openwork-server"
SESSIONS_DIR="${SESSIONS_DIR:-/var/workspace/sessions}"
OPENWORK_PORT="${OPENWORK_PORT:-8787}"
PROXY_PORT="${PROXY_PORT:-3000}"
GATEWAY_OPENCODE_PORT="${GATEWAY_OPENCODE_PORT:-3001}"
OPENWORK_APPROVAL="${OPENWORK_APPROVAL:-auto}"
DATA_HOME="${DATA_HOME:-/home/openwork/.local/share}"
RUNTIME_CONFIG="${RUNTIME_CONFIG:-/tmp/corina-opencode.jsonc}"

log() { echo "[entrypoint] $(date '+%H:%M:%S') $*"; }

if [ -n "${AZURE_OPENAI_API_KEY:-}" ]; then
    export OPENAI_API_KEY="${AZURE_OPENAI_API_KEY}"
    export OPENAI_BASE_URL="${AZURE_OPENAI_ENDPOINT:+${AZURE_OPENAI_ENDPOINT}/openai}"
fi

if [ -n "${AZURE_RESOURCE_NAME:-}" ]; then
    export AZURE_OPENAI_RESOURCE_NAME="${AZURE_RESOURCE_NAME}"
fi
if [ -n "${AZURE_API_KEY:-}" ]; then
    export AZURE_OPENAI_API_KEY="${AZURE_API_KEY}"
fi

if ! command -v opencode >/dev/null 2>&1; then
    log "opencode not found, installing..."
    npm install -g "opencode-ai@${OPENCODE_VERSION:-latest}" --loglevel=warn
fi
if ! command -v openwork-server >/dev/null 2>&1; then
    log "openwork-server not found, installing..."
    npm install -g "openwork-server@${OPENWORK_SERVER_VERSION:-latest}" --loglevel=warn
fi

log "opencode $(opencode --version) | openwork-server $(openwork-server --version)"

if [ -n "${WORKSPACE_GIT_URL:-}" ] && [ ! -d "${SOURCE_WORKSPACE_DIR}/.git" ]; then
    log "Cloning workspace from ${WORKSPACE_GIT_URL}..."
    rm -rf "${SOURCE_WORKSPACE_DIR:?}/"*
    git clone "${WORKSPACE_GIT_URL}" "${SOURCE_WORKSPACE_DIR}"
fi

prepare_runtime_workspace() {
    log "Preparing mutable runtime workspace at ${RUNTIME_WORKSPACE_DIR}..."
    rm -rf "${RUNTIME_WORKSPACE_DIR}"
    mkdir -p "${RUNTIME_WORKSPACE_DIR}"

    shopt -s dotglob nullglob
    for source_path in "${SOURCE_WORKSPACE_DIR}"/*; do
        local name
        name="$(basename "${source_path}")"
        case "${name}" in
            .|..|.git|.opencode|.corina-local|dist)
                continue
                ;;
        esac
        ln -s "${source_path}" "${RUNTIME_WORKSPACE_DIR}/${name}"
    done
    shopt -u dotglob nullglob

    if [ -d "${SOURCE_WORKSPACE_DIR}/.opencode" ]; then
        cp -a "${SOURCE_WORKSPACE_DIR}/.opencode" "${RUNTIME_WORKSPACE_DIR}/.opencode"
    fi

    if [ -d "${SOURCE_WORKSPACE_DIR}/.corina-local" ]; then
        cp -a "${SOURCE_WORKSPACE_DIR}/.corina-local" "${RUNTIME_WORKSPACE_DIR}/.corina-local"
    else
        mkdir -p "${RUNTIME_WORKSPACE_DIR}/.corina-local/prompts"
    fi
}

prepare_runtime_workspace

cd "${WORKSPACE_DIR}"

if [ ! -d node_modules ] || [ ! -d deps ]; then
    log "Installing Corina root dependencies..."
    npm install --loglevel=warn
fi

if [ ! -d dist ]; then
    log "Building Corina package..."
    npm run build
fi

log "Refreshing Corina local agent installs..."
CORINA_INSTALL_ROOT="${WORKSPACE_DIR}" npm run install-corina

rm -f /home/openwork/.config/opencode/bun.lockb /home/openwork/.config/opencode/bun.lock 2>/dev/null || true

OPENCODE_DIR="${WORKSPACE_DIR}/.opencode"
if [ -d "${OPENCODE_DIR}" ]; then
    rm -f "${OPENCODE_DIR}/bun.lock" "${OPENCODE_DIR}/bun.lockb" 2>/dev/null || true

    NEED_INSTALL=false
    for pkg in "@ai-sdk/azure" "@ai-sdk/anthropic" "@ai-sdk/openai-compatible"; do
        if [ ! -d "${OPENCODE_DIR}/node_modules/${pkg}" ]; then
            NEED_INSTALL=true
            break
        fi
    done
    if [ "${NEED_INSTALL}" = true ]; then
        log "Installing OpenCode provider packages in ${OPENCODE_DIR}..."
        (cd "${OPENCODE_DIR}" && npm install @ai-sdk/azure @ai-sdk/anthropic @ai-sdk/openai-compatible --loglevel=warn)
    fi
fi

log "Generating runtime OpenCode config from deployment template..."
node - "${DEPLOY_DIR}/opencode.jsonc" "${RUNTIME_CONFIG}" <<'NODE'
const fs = require("fs");

const [templatePath, outputPath] = process.argv.slice(2);
const raw = fs.readFileSync(templatePath, "utf8");

function stripJsonComments(input) {
  let clean = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (esc) {
      clean += c;
      esc = false;
      continue;
    }
    if (c === "\\" && inStr) {
      clean += c;
      esc = true;
      continue;
    }
    if (c === "\"") {
      inStr = !inStr;
      clean += c;
      continue;
    }
    if (!inStr && c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      clean += "\n";
      continue;
    }
    if (!inStr && c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++;
      continue;
    }
    clean += c;
  }
  return clean;
}

const config = JSON.parse(stripJsonComments(raw));

if (process.env.OPENCODE_MODEL) {
  config.model = process.env.OPENCODE_MODEL;
}

config.provider = config.provider || {};

const azureResource = process.env.AZURE_RESOURCE_NAME;
const azureKey = process.env.AZURE_API_KEY;
const proxyPort = process.env.PROXY_PORT || "3000";
if (azureResource && azureKey && config.model?.startsWith("azure-openai/")) {
  const modelId = config.model.split("/").slice(1).join("/");
  config.provider["azure-openai"] = {
    npm: "@ai-sdk/azure",
    options: {
      baseURL: `https://${azureResource}.services.ai.azure.com/openai`,
      apiKey: azureKey,
    },
    models: { [modelId]: { name: modelId } },
  };
}
if (azureResource && azureKey && config.model?.startsWith("azure-anthropic/")) {
  const modelId = config.model.split("/").slice(1).join("/");
  config.provider["azure-anthropic"] = {
    npm: "@ai-sdk/anthropic",
    name: "Azure Anthropic",
    options: {
      baseURL: `https://${azureResource}.services.ai.azure.com/anthropic/v1`,
      apiKey: azureKey,
    },
    models: { [modelId]: { name: modelId } },
  };
}
if (azureResource && azureKey && config.model?.startsWith("azure-opensource/")) {
  const modelId = config.model.split("/").slice(1).join("/");
  config.provider["azure-opensource"] = {
    npm: "@ai-sdk/openai-compatible",
    name: "Azure Open-Source",
    options: { baseURL: `http://127.0.0.1:${proxyPort}/azure-opensource` },
    models: { [modelId]: { name: modelId } },
  };
}

const foundryUrl = process.env.MICROSOFT_FOUNDRY_BASE_URL;
const foundryKey = process.env.MICROSOFT_FOUNDRY_API_KEY;
const foundryApiType = process.env.MICROSOFT_FOUNDRY_API_TYPE || "responses";
if (foundryUrl && foundryKey && config.model?.startsWith("foundry/")) {
  const modelId = config.model.split("/").slice(1).join("/");
  if (foundryApiType === "completions") {
    config.provider.foundry = {
      npm: "@ai-sdk/openai-compatible",
      name: "Microsoft Foundry",
      options: { baseURL: `http://127.0.0.1:${proxyPort}/foundry` },
      models: { [modelId]: { name: modelId } },
    };
  } else {
    config.provider.foundry = {
      npm: "@ai-sdk/azure",
      name: "Microsoft Foundry",
      options: { baseURL: foundryUrl.replace(/\/+$/, ""), apiKey: foundryKey },
      models: { [modelId]: { name: modelId } },
    };
  }
}

const ghToken = process.env.GH_COPILOT_TOKEN;
if (ghToken && config.mcp?.github) {
  config.mcp.github.headers = { Authorization: `Bearer ${ghToken}` };
}

const figmaKey = process.env.FIGMA_API_KEY;
if (figmaKey && config.mcp?.figma) {
  config.mcp.figma.environment = { FIGMA_API_KEY: figmaKey };
}

fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
NODE
export OPENCODE_CONFIG_TEMPLATE="${RUNTIME_CONFIG}"

cleanup() {
    log "Shutting down..."
    kill 0 2>/dev/null || true
    wait || true
    log "Shutdown complete."
}
trap cleanup SIGTERM SIGINT

DB_TEMPLATE_DIR="${DATA_HOME}/opencode-db-template"
DB_TEMPLATE_FILE="${DB_TEMPLATE_DIR}/opencode.db"
if [ ! -f "${DB_TEMPLATE_FILE}" ]; then
    log "Pre-warming opencode database migration..."
    mkdir -p "${DB_TEMPLATE_DIR}"
    PREWARM_PORT=9999
    XDG_DATA_HOME="${DB_TEMPLATE_DIR}" opencode serve --hostname 127.0.0.1 --port "${PREWARM_PORT}" --print-logs &
    PREWARM_PID=$!
    PREWARM_READY=false
    for _ in $(seq 1 90); do
        sleep 1
        if curl -sf "http://127.0.0.1:${PREWARM_PORT}/global/health" >/dev/null 2>&1; then
            PREWARM_READY=true
            break
        fi
    done
    kill "${PREWARM_PID}" 2>/dev/null || true
    wait "${PREWARM_PID}" 2>/dev/null || true
    if [ "${PREWARM_READY}" = true ] && [ -f "${DB_TEMPLATE_DIR}/opencode/opencode.db" ]; then
        cp "${DB_TEMPLATE_DIR}/opencode/opencode.db" "${DB_TEMPLATE_FILE}"
        log "DB template created at ${DB_TEMPLATE_FILE}"
    else
        log "WARN: DB pre-warm failed; sessions will migrate on first use"
        rm -f "${DB_TEMPLATE_FILE}"
    fi
fi

mkdir -p "${SESSIONS_DIR}" "${DATA_HOME}/sessions"
rm -rf "${SESSIONS_DIR}"/* "${DATA_HOME}/sessions"/* 2>/dev/null || true

log "Starting gateway on :${GATEWAY_OPENCODE_PORT} and proxy on :${PROXY_PORT}..."
export PROXY_PORT GATEWAY_OPENCODE_PORT WORKSPACE_DIR SESSIONS_DIR DATA_HOME SOURCE_WORKSPACE_DIR RUNTIME_WORKSPACE_DIR
node --input-type=module -e "import '/opt/proxy/server.js'; import '/opt/proxy/gateway.js';" &

sleep 2

log "Pre-creating Corina OpenWork session..."
OPENWORK_SESSION=$(node -e "
const h=require('http');
const r=h.request({host:'127.0.0.1',port:${GATEWAY_OPENCODE_PORT},path:'/_sessions',method:'POST',headers:{'Content-Type':'application/json'}},s=>{
  let d='';s.on('data',c=>d+=c);
  s.on('end',()=>{const j=JSON.parse(d);process.stdout.write(j.id+'|'+j.port+'|'+j.workDir)});
});
r.write('{}');r.end()
" 2>/dev/null)

OPENWORK_SESSION_ID="$(echo "${OPENWORK_SESSION}" | cut -d'|' -f1)"
OPENWORK_SERVE_PORT="$(echo "${OPENWORK_SESSION}" | cut -d'|' -f2)"
OPENWORK_WORK_DIR="$(echo "${OPENWORK_SESSION}" | cut -d'|' -f3)"

if [ -z "${OPENWORK_SERVE_PORT}" ]; then
    log "ERROR: failed to pre-create Corina OpenWork session"
    exit 1
fi

node -e "const h=require('http');const r=h.request({host:'127.0.0.1',port:${GATEWAY_OPENCODE_PORT},path:'/_sessions/${OPENWORK_SESSION_ID}/pin',method:'POST'},()=>{});r.end()" 2>/dev/null
log "Corina session ${OPENWORK_SESSION_ID} pinned on port ${OPENWORK_SERVE_PORT}"

OPENWORK_ARGS=(
    --host 0.0.0.0
    --port "${OPENWORK_PORT}"
    --workspace "${WORKSPACE_DIR}"
    --approval "${OPENWORK_APPROVAL}"
    --cors "*"
    --verbose
    --opencode-base-url "http://127.0.0.1:${OPENWORK_SERVE_PORT}"
    --opencode-directory "${OPENWORK_WORK_DIR}"
)
if [ -n "${PROXY_API_KEY:-}" ]; then
    OPENWORK_ARGS+=(--token "${PROXY_API_KEY}")
fi

log "Starting openwork-server on port ${OPENWORK_PORT}..."
openwork-server "${OPENWORK_ARGS[@]}" 2>&1 | sed -u 's/^/[openwork] /' &

sleep 3

GATEWAY_PORT="${GATEWAY_PORT:-8443}"
log "Starting nginx on port ${GATEWAY_PORT}..."
nginx -g 'daemon off;' 2>&1 | sed -u 's/^/[nginx] /' &

sleep 1

log "All services ready on :${GATEWAY_PORT}"
log "  /openwork/ -> OpenWork bound to Corina"
log "  /opencode/ -> per-session OpenCode gateway"
log "  /v1/ -> OpenAI-compatible proxy"
log "  /health, /stats, /sessions"

wait
