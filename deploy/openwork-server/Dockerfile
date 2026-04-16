FROM node:22-slim

LABEL maintainer="Corina"
LABEL description="Corina OpenWork deployment wrapper"

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    tini \
    nginx \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 openwork \
    && useradd --uid 1001 --gid openwork --shell /bin/bash --create-home openwork

ARG OPENCODE_VERSION=latest
ARG OPENWORK_SERVER_VERSION=latest
RUN npm install -g "opencode-ai@${OPENCODE_VERSION}" "openwork-server@${OPENWORK_SERVER_VERSION}" --loglevel=warn \
    && npm install -g @ivotoby/openapi-mcp-server --loglevel=warn \
    && opencode --version \
    && chmod +x /usr/local/lib/node_modules/openwork-server/dist/bin/* 2>/dev/null || true

RUN mkdir -p /home/openwork/.cache/opencode /var/workspace/sessions /workspace \
    && chown -R openwork:openwork /home/openwork /var/workspace /workspace

COPY deploy/openwork-server/proxy/package.json /opt/proxy/package.json
RUN cd /opt/proxy && npm install --omit=dev --loglevel=warn
COPY deploy/openwork-server/proxy/ /opt/proxy/

COPY deploy/openwork-server/nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /tmp/nginx /var/lib/nginx /var/log/nginx \
    && chown -R openwork:openwork /tmp/nginx /var/lib/nginx /var/log/nginx /var/run \
    && touch /run/nginx.pid && chown openwork:openwork /run/nginx.pid

COPY deploy/openwork-server/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

COPY . /workspace
WORKDIR /workspace
RUN npm install --loglevel=warn \
    && npm run build \
    && npm run install-corina \
    && chown -R openwork:openwork /workspace

USER openwork

RUN cd /home/openwork/.cache/opencode \
    && npm init -y --silent 2>/dev/null \
    && npm install @ai-sdk/azure @ai-sdk/anthropic @ai-sdk/openai-compatible --loglevel=warn

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:8443/health || exit 1

EXPOSE 8443 3001

ENTRYPOINT ["tini", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
