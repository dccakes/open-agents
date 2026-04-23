/**
 * Create a fresh base snapshot for this Vercel account.
 * Run this once to bootstrap your own snapshot, then set
 * VERCEL_SANDBOX_BASE_SNAPSHOT_ID in your Vercel env vars.
 *
 * Usage:
 *   VERCEL_ACCESS_TOKEN=... bun run scripts/create-base-snapshot.ts
 */

import { VercelSandbox } from "../packages/sandbox/vercel/sandbox.ts";
import {
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "../apps/web/lib/sandbox/config.ts";

async function main() {
  console.log("Creating fresh sandbox (no base snapshot)...");

  const sandbox = await VercelSandbox.create({
    timeout: 2_670_000, // 44.5 min — SDK adds 30s buffer, keeping under 2700000ms API limit
    persistent: false,
    skipGitWorkspaceBootstrap: true,
    ports: DEFAULT_SANDBOX_PORTS,
  });

  console.log("Sandbox created. Installing tools...");

  const commands = [
    "whoami",
    "echo $HOME",
    "ls /home || true",
    "mkdir -p /vercel/sandbox/bin",
    "curl -fsSL https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64 -o /vercel/sandbox/bin/jq && chmod +x /vercel/sandbox/bin/jq",
    "/vercel/sandbox/bin/jq --version",
    "curl -fsSL https://bun.sh/install | bash",
    "/root/.bun/bin/bun --version || $HOME/.bun/bin/bun --version",
  ];

  for (const cmd of commands) {
    console.log(`Running: ${cmd}`);
    const result = await sandbox.exec(cmd, "/vercel/sandbox", 5 * 60 * 1000);
    console.log(`Exit code: ${result.exitCode}`);
    console.log(`Output: ${result.stdout}`);
    if (!result.success) {
      await sandbox.stop();
      process.exit(1);
    }
  }

  console.log("Creating snapshot...");
  const { snapshotId } = await sandbox.snapshot();

  console.log("");
  console.log(`New snapshot id: ${snapshotId}`);
  console.log(`Set VERCEL_SANDBOX_BASE_SNAPSHOT_ID=${snapshotId} in Vercel env vars.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error && typeof error === "object") {
    console.error("json:", JSON.stringify((error as Record<string, unknown>).json ?? null, null, 2));
    console.error("text:", (error as Record<string, unknown>).text);
    console.error("full:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
  }
  process.exit(1);
});
