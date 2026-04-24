# Local development sandbox image.
# Build: docker build -t open-agents/sandbox-dev:latest packages/sandbox/providers/docker/
# Then set DOCKER_SANDBOX_IMAGE=open-agents/sandbox-dev:latest in apps/web/.env.local

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    bash \
    curl \
    git \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

# bun — used by agent tools and dev-server detection
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

# code-server — required for the in-browser VS Code editor (/code-editor route)
RUN curl -fsSL https://code-server.dev/install.sh | sh \
    && rm -rf /tmp/code-server-install*

RUN mkdir -p /workspace
WORKDIR /workspace

# Keep container alive so exec calls work
CMD ["sleep", "infinity"]
