import type { ConnectOptions } from "./factory";
import type { Sandbox } from "./interface";

export type SandboxProviderType = "vercel" | "docker" | "daytona";

export interface SandboxCapabilities {
  /** Filesystem state survives stop/restart across sessions */
  persistent: boolean;
  /** Provider can provision a session-scoped Postgres database */
  db: boolean;
  /** Provider accepts injected env vars at sandbox creation time */
  envInjection: boolean;
  /** Provider uses approved credential brokering (no token remotes) */
  credentialBrokering: boolean;
}

export interface SandboxConfigField {
  key: string;
  label: string;
  type: "text" | "url" | "password";
  required: boolean;
  placeholder?: string;
}

export interface SandboxProviderDef<S = unknown> {
  type: SandboxProviderType;
  label: string;
  beta?: boolean;
  capabilities: SandboxCapabilities;
  configFields?: SandboxConfigField[];
  isAvailable(): boolean;
  reasonUnavailable(): string | undefined;
  create(state: S, options?: ConnectOptions): Promise<Sandbox>;
  connect(state: S, options?: ConnectOptions): Promise<Sandbox>;
}
