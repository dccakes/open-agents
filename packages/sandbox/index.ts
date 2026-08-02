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

// providers / registry
export type {
  SandboxProviderType,
  SandboxCapabilities,
  SandboxConfigField,
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

// git helpers (used by many app-level callers)
export {
  hasUncommittedChanges,
  stageAll,
  getCurrentBranch,
  getHeadSha,
  getStagedDiff,
  getChangedFiles,
  detectBinaryFiles,
  readFileContents,
  getFileModes,
  syncToRemote,
  syncToRemotePreservingChanges,
  withTemporaryGitHubAuth,
  type FileChange,
  type FileChangeStatus,
  type FileWithContent,
} from "./git";

// vercel (re-exported from provider registration)
export {
  connectVercelSandbox,
  VercelSandbox,
  type VercelSandboxConfig,
  type VercelSandboxConnectConfig,
  type VercelState,
} from "./providers/vercel";
