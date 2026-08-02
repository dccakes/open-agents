import type { SandboxProviderDef } from "../../provider";
import { defaultRegistry } from "../../registry";
import { connectVercel } from "../../vercel/connect";
import type { VercelState } from "../../vercel/state";

export { VercelSandbox, connectVercelSandbox } from "../../vercel/sandbox";
export type {
  VercelSandboxConfig,
  VercelSandboxConnectConfig,
} from "../../vercel/config";
export type { VercelState } from "../../vercel/state";
export { connectVercel } from "../../vercel/connect";
export {
  DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS,
  refreshBaseSnapshot,
} from "../../vercel/snapshot-refresh";
export type {
  RefreshBaseSnapshotCommandResult,
  RefreshBaseSnapshotOptions,
  RefreshBaseSnapshotResult,
} from "../../vercel/snapshot-refresh";

export const vercelProvider: SandboxProviderDef<VercelState> = {
  type: "vercel",
  label: "Vercel",
  capabilities: {
    persistent: true,
    db: true,
    envInjection: true,
    credentialBrokering: true,
  },
  configFields: [
    {
      key: "VERCEL_SANDBOX_BASE_SNAPSHOT_ID",
      label: "Base Snapshot ID",
      type: "text",
      required: false,
      placeholder: "snp_xxxxx",
    },
    {
      key: "VERCEL_TEAM",
      label: "Vercel Team",
      type: "text",
      required: false,
      placeholder: "my-team",
    },
    {
      key: "VERCEL_PROJECT",
      label: "Vercel Project",
      type: "text",
      required: false,
      placeholder: "my-project",
    },
  ],
  isAvailable: () => true,
  reasonUnavailable: () => undefined,
  create: (state, options) => connectVercel(state, options),
  connect: (state, options) => connectVercel(state, options),
};

defaultRegistry.register(vercelProvider);
