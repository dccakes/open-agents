# Local development sandbox image — mirrors the Vercel base snapshot tool set.
# See scripts/create-base-snapshot.ts for the canonical Vercel snapshot build.
#
# Build:  docker build -t open-agents/sandbox-dev:latest packages/sandbox/providers/docker/
# Configure: DOCKER_SANDBOX_IMAGE=open-agents/sandbox-dev:latest in apps/web/.env.local

FROM node:22-bookworm-slim

# System packages + Chromium runtime dependencies (required by agent-browser/Playwright)
RUN apt-get update && apt-get install -y \
    bash \
    curl \
    git \
    ca-certificates \
    procps \
    jq \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# bun — JS runtime, package manager, script runner
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
COPY --from=oven/bun:1 /usr/local/bin/bunx /usr/local/bin/bunx

# Route bun global installs to /usr/local so binaries land on PATH
ENV BUN_INSTALL=/usr/local

# code-server — in-browser VS Code editor (required for /code-editor route)
RUN curl -fsSL https://code-server.dev/install.sh | sh \
    && rm -rf /tmp/code-server-install*

# agent-browser + chromium — browser automation for agent UI validation
RUN bun install -g agent-browser \
    && bunx agent-browser install chromium

RUN mkdir -p /workspace
WORKDIR /workspace

# Keep container alive so exec calls work
CMD ["sleep", "infinity"]
