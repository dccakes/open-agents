/**
 * Create a fresh base snapshot for this Vercel account.
 * Run this once to bootstrap your own snapshot, then set
 * VERCEL_SANDBOX_BASE_SNAPSHOT_ID in your Vercel env vars.
 *
 * Usage:
 *   VERCEL_ACCESS_TOKEN=... VERCEL_TEAM_ID=... bun run scripts/create-base-snapshot.ts
 */

import { VercelSandbox } from "../packages/sandbox/vercel/sandbox.ts";
import { DEFAULT_SANDBOX_PORTS } from "../apps/web/lib/sandbox/config.ts";

const BIN = "/vercel/sandbox/bin";
const TIMEOUT_MS = 5 * 60 * 1000; // 5 min per command

async function main() {
  console.log("Creating fresh sandbox...");

  const sandbox = await VercelSandbox.create({
    timeout: 2_670_000, // 44.5 min — SDK adds 30s buffer, keeping under 2700000ms API limit
    persistent: false,
    skipGitWorkspaceBootstrap: true,
    ports: DEFAULT_SANDBOX_PORTS,
  });

  console.log("Sandbox created. Installing tools...");

  const commands: Array<{ label: string; cmd: string; timeoutMs?: number }> = [
    // Basics
    { label: "create bin dir", cmd: `mkdir -p ${BIN}` },

    // jq — install as static binary
    {
      label: "install jq",
      cmd: `curl -fsSL https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64 -o ${BIN}/jq && chmod +x ${BIN}/jq`,
    },
    { label: "verify jq", cmd: `${BIN}/jq --version` },

    // bun
    { label: "install bun", cmd: "curl -fsSL https://bun.sh/install | bash" },
    { label: "verify bun", cmd: "$HOME/.bun/bin/bun --version" },

    // code-server (VS Code in browser on port 8000)
    {
      label: "install code-server",
      cmd: "curl -fsSL https://code-server.dev/install.sh | sh -s -- --method standalone --prefix $HOME/.local",
      timeoutMs: 10 * 60 * 1000,
    },
    { label: "verify code-server", cmd: "$HOME/.local/bin/code-server --version" },

    // agent-browser + chromium (browser automation for UI testing)
    {
      label: "install agent-browser",
      cmd: "$HOME/.bun/bin/bun install -g agent-browser",
      timeoutMs: 10 * 60 * 1000,
    },
    {
      label: "install chromium for agent-browser",
      cmd: "$HOME/.bun/bin/bunx agent-browser install chromium",
      timeoutMs: 10 * 60 * 1000,
    },
    { label: "verify agent-browser", cmd: "$HOME/.bun/bin/agent-browser --version" },

    // Add all tools to PATH permanently
    {
      label: "update PATH in bash_profile",
      cmd: `echo 'export PATH="${BIN}:$HOME/.bun/bin:$HOME/.local/bin:$PATH"' >> $HOME/.bash_profile`,
    },

    // Final verification
    {
      label: "verify all tools",
      cmd: `echo "jq: $(${BIN}/jq --version)" && echo "bun: $($HOME/.bun/bin/bun --version)" && echo "code-server: $($HOME/.local/bin/code-server --version)" && echo "agent-browser: $($HOME/.bun/bin/agent-browser --version)"`,
    },
  ];

  for (const { label, cmd, timeoutMs } of commands) {
    console.log(`\n[${label}]`);
    const result = await sandbox.exec(cmd, "/vercel/sandbox", timeoutMs ?? TIMEOUT_MS);
    if (result.stdout.trim()) console.log(result.stdout.trim());
    if (!result.success) {
      console.error(`FAILED (exit ${result.exitCode})`);
      await sandbox.stop();
      process.exit(1);
    }
    console.log(`✓ done`);
  }

  console.log("\nCreating snapshot...");
  const { snapshotId } = await sandbox.snapshot();

  console.log(`\nNew snapshot id: ${snapshotId}`);
  console.log(`\n1. Set in Vercel env vars (Production + Preview):`);
  console.log(`   VERCEL_SANDBOX_BASE_SNAPSHOT_ID=${snapshotId}`);
  console.log(`\n2. Update apps/web/lib/sandbox/config.ts fallback to: "${snapshotId}"`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    if (e.json) console.error("API error:", JSON.stringify(e.json, null, 2));
  }
  process.exit(1);
});
