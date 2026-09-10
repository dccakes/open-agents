/**
 * Create a new sandbox base snapshot from the currently configured snapshot.
 * Defaults (snapshot id, ports, timeouts) come from the web app sandbox config so
 * this matches production; `refreshBaseSnapshot` skips workspace git bootstrap
 * so the new image stays clone-ready (see `@open-agents/sandbox` snapshot-refresh).
 *
 * Usage:
 *   bun run sandbox:snapshot-base --setup-base
 *   bun run sandbox:snapshot-base --from snap_123 --command "sudo dnf install -y jq"
 */

import {
  DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS,
  refreshBaseSnapshot,
} from "@open-agents/sandbox/vercel";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "../apps/web/lib/sandbox/config";

const SANDBOX_BASE_SNAPSHOT_CONFIG_PATH = "apps/web/lib/sandbox/config.ts";

interface CliOptions {
  setupBase: boolean;
  baseSnapshotId?: string;
  sandboxTimeoutMs?: number;
  commandTimeoutMs?: number;
  commands: string[];
}

interface HelpResult {
  help: true;
}

function printUsage() {
  console.log(`Usage:
  bun run sandbox:snapshot-base -- --command "sudo dnf upgrade -y"
  bun run sandbox:snapshot-base -- --from snap_123 --command "sudo dnf install -y jq"
  bun run sandbox:snapshot-base --setup-base

Options:
  --setup-base                Install Bun, code-server, and browser automation tools
  --from <snapshot-id>         Override the starting snapshot id
  --command <shell-command>    Command to run inside the sandbox. Repeat as needed.
  --sandbox-timeout-ms <ms>    Sandbox lifetime for the refresh run
  --command-timeout-ms <ms>    Timeout for each setup command (default: ${DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS})
  --help                       Show this message

Current configured base snapshot:
  ${DEFAULT_SANDBOX_BASE_SNAPSHOT_ID ?? "Vercel standard runtime"}`);
}

function requireOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }

  return value;
}

function parsePositiveNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive number.`);
  }

  return parsed;
}

function parseArgs(argv: string[]): CliOptions | HelpResult {
  const commands: string[] = [];
  let setupBase = false;
  let baseSnapshotId: string | undefined;
  let sandboxTimeoutMs: number | undefined;
  let commandTimeoutMs: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--setup-base") {
      setupBase = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--from") {
      baseSnapshotId = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--command") {
      commands.push(requireOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--sandbox-timeout-ms") {
      sandboxTimeoutMs = parsePositiveNumber(
        requireOptionValue(argv, index, arg),
        arg,
      );
      index += 1;
      continue;
    }

    if (arg === "--command-timeout-ms") {
      commandTimeoutMs = parsePositiveNumber(
        requireOptionValue(argv, index, arg),
        arg,
      );
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    setupBase,
    baseSnapshotId,
    sandboxTimeoutMs,
    commandTimeoutMs,
    commands,
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    printUsage();
    return;
  }

  const commands = [...parsed.commands];
  if (parsed.setupBase) {
    commands.unshift(
      await Bun.file(
        new URL("vercel-sandbox-base-setup.sh", import.meta.url),
      ).text(),
    );
  }

  const result = await refreshBaseSnapshot({
    baseSnapshotId: parsed.baseSnapshotId ?? DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
    commands,
    sandboxTimeoutMs: parsed.sandboxTimeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
    commandTimeoutMs: parsed.commandTimeoutMs,
    ports: DEFAULT_SANDBOX_PORTS,
    log: (message) => console.log(message),
  });

  console.log("");
  console.log(`New snapshot id: ${result.snapshotId}`);
  console.log(
    `Started from: ${result.sourceSnapshotId ?? "Vercel standard runtime"}`,
  );
  console.log(
    `Set VERCEL_SANDBOX_BASE_SNAPSHOT_ID=${result.snapshotId} for ${SANDBOX_BASE_SNAPSHOT_CONFIG_PATH}`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
