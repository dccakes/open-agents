// Register built-in providers (side-effect imports)
import "./providers/vercel";
import "./providers/daytona";
import "./providers/docker";

// interface
export type {
  ExecResult,
  Sandbox,
  SandboxHook,
  SandboxHooks,
  SandboxStats,
  SandboxType,
  SnapshotResult,
} from "./interface";

// shared types
export type { Source, FileEntry, SandboxStatus } from "./types";

// providers
export type {
  SandboxProviderType,
  SandboxCapabilities,
  SandboxProviderDef,
} from "./provider";
export { SandboxRegistry, defaultRegistry } from "./registry";

// factory
export {
  connectSandbox,
  type SandboxState,
  type ConnectOptions,
  type SandboxConnectConfig,
} from "./factory";

// vercel
export {
  connectVercelSandbox,
  VercelSandbox,
  type VercelSandboxConfig,
  type VercelSandboxConnectConfig,
  type VercelState,
} from "./providers/vercel";
