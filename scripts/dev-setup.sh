#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash scripts/dev-setup.sh

Bootstraps local development dependencies:
- checks required tools (`docker`, `bun`)
- starts local postgres via docker compose
- waits for postgres readiness
- creates apps/web/.env.local with local-only defaults (if missing)
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "Unknown argument: $1" >&2
  usage >&2
  exit 1
fi

for required_cmd in docker bun; do
  if ! command -v "$required_cmd" >/dev/null 2>&1; then
    echo "Missing required command: $required_cmd" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is required but not available via 'docker compose'." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
env_file="${repo_root}/apps/web/.env.local"

echo "Starting local postgres container..."
(
  cd "${repo_root}"
  docker compose up -d postgres
)

echo "Waiting for postgres to accept connections..."
attempt=0
max_attempts=30
until (
  cd "${repo_root}"
  docker compose exec postgres pg_isready -U postgres >/dev/null 2>&1
); do
  attempt=$((attempt + 1))
  if [[ "${attempt}" -ge "${max_attempts}" ]]; then
    echo "Timed out waiting for postgres readiness." >&2
    exit 1
  fi
  sleep 2
done

if [[ ! -f "${env_file}" ]]; then
  cat >"${env_file}" <<'EOF'
# Local development defaults only. NOT FOR PRODUCTION.
POSTGRES_URL=postgresql://postgres:devpassword@localhost:5432/open_agents_dev
EOF
  echo "Created ${env_file}"
else
  echo "Found existing ${env_file}; leaving it unchanged."
fi

cat <<'EOF'
Local bootstrap complete.

Next steps:
1. bun install
2. bun run web
3. Add any additional local env vars in apps/web/.env.local for integrations you use
EOF
