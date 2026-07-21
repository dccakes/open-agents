import type { ConnectOptions, SandboxState } from "./factory";
import type { Sandbox } from "./interface";
import type { SandboxProviderDef, SandboxProviderType } from "./provider";

const LEGACY_PROVIDER_ALIASES: Record<string, SandboxProviderType> = {
  cloud: "vercel",
};

function resolveProviderType(raw: string): SandboxProviderType {
  return (LEGACY_PROVIDER_ALIASES[raw] ?? raw) as SandboxProviderType;
}

export class SandboxRegistry {
  private readonly providers = new Map<
    SandboxProviderType,
    SandboxProviderDef
  >();

  register(def: SandboxProviderDef): void {
    this.providers.set(def.type, def);
  }

  get(type: SandboxProviderType): SandboxProviderDef | undefined {
    return this.providers.get(type);
  }

  list(): SandboxProviderDef[] {
    return [...this.providers.values()];
  }

  listAvailable(): SandboxProviderDef[] {
    return this.list().filter((d) => d.isAvailable());
  }

  async create(
    type: SandboxProviderType,
    state: unknown,
    options?: ConnectOptions,
  ): Promise<Sandbox> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Unknown sandbox provider: ${type}`);
    }
    return provider.create(state, options);
  }

  async connect(
    state: SandboxState,
    options?: ConnectOptions,
  ): Promise<Sandbox> {
    const resolvedType = resolveProviderType(state.type);
    const provider = this.providers.get(resolvedType);
    if (!provider) {
      throw new Error(`Unknown sandbox provider: ${state.type}`);
    }
    return provider.connect(state, options);
  }
}

export const defaultRegistry = new SandboxRegistry();
