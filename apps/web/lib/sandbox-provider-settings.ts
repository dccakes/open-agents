import type {
  SandboxCapabilities,
  SandboxConfigField,
  SandboxProviderDef,
  SandboxProviderType,
} from "@open-agents/sandbox";
import type { UserSandboxConfigData } from "@/lib/db/sandbox-configs";

interface ResolvedConfigEntry {
  key: string;
  value: string;
  source: "saved" | "env";
  isSecret: boolean;
}

export interface SandboxProviderSettingsData {
  type: SandboxProviderType;
  label: string;
  beta: boolean;
  capabilities: SandboxCapabilities;
  configFields: SandboxConfigField[];
  isAvailable: boolean;
  reasonUnavailable?: string;
  enabled: boolean;
  config: Record<string, string>;
  secretConfigKeys: string[];
  environmentConfigKeys: string[];
  overriddenEnvironmentConfigKeys: string[];
  isConfigured: boolean;
}

function normalizeConfigValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function resolveConfigEntries(
  configFields: SandboxConfigField[],
  savedConfig: Record<string, string>,
): ResolvedConfigEntry[] {
  // TODO(quality-review): Accept an injected env map instead of reading
  // process.env directly to reduce global-state coupling.
  const entries: ResolvedConfigEntry[] = [];

  for (const field of configFields) {
    const savedValue = normalizeConfigValue(savedConfig[field.key]);
    const envValue = normalizeConfigValue(process.env[field.key]);

    if (savedValue) {
      entries.push({
        key: field.key,
        value: savedValue,
        source: "saved",
        isSecret: field.type === "password",
      });
      continue;
    }

    if (envValue) {
      entries.push({
        key: field.key,
        value: envValue,
        source: "env",
        isSecret: field.type === "password",
      });
    }
  }

  return entries;
}

export function buildEffectiveProviderConfig(
  configFields: SandboxConfigField[],
  savedConfig: Record<string, string>,
): Record<string, string> {
  const effectiveConfig: Record<string, string> = {};

  for (const entry of resolveConfigEntries(configFields, savedConfig)) {
    effectiveConfig[entry.key] = entry.value;
  }

  return effectiveConfig;
}

export function isConfiguredProvider(
  configFields: SandboxConfigField[],
  savedConfig: Record<string, string>,
): boolean {
  const effectiveConfig = buildEffectiveProviderConfig(
    configFields,
    savedConfig,
  );
  const requiredFields = configFields.filter((field) => field.required);

  if (requiredFields.length > 0) {
    return requiredFields.every((field) => effectiveConfig[field.key]);
  }

  if (configFields.length === 0) {
    return true;
  }

  return Object.keys(effectiveConfig).length > 0;
}

export function buildSandboxProviderSettingsData(
  provider: SandboxProviderDef,
  userConfig: UserSandboxConfigData | undefined,
): SandboxProviderSettingsData {
  const configFields = provider.configFields ?? [];
  const savedConfig = userConfig?.config ?? {};
  const resolvedEntries = resolveConfigEntries(configFields, savedConfig);
  const config: Record<string, string> = {};
  const secretConfigKeys: string[] = [];
  const environmentConfigKeys: string[] = [];
  const overriddenEnvironmentConfigKeys: string[] = [];

  for (const entry of resolvedEntries) {
    const envValue = normalizeConfigValue(process.env[entry.key]);
    if (entry.source === "saved" && envValue) {
      overriddenEnvironmentConfigKeys.push(entry.key);
    }

    if (entry.source === "env") {
      environmentConfigKeys.push(entry.key);
    }

    if (entry.source === "saved" && entry.isSecret) {
      secretConfigKeys.push(entry.key);
      continue;
    }

    if (entry.source === "saved") {
      config[entry.key] = entry.value;
    }
  }

  return {
    type: provider.type,
    label: provider.label,
    beta: provider.beta ?? false,
    capabilities: provider.capabilities,
    configFields,
    isAvailable: provider.isAvailable(),
    reasonUnavailable: provider.reasonUnavailable(),
    enabled: userConfig?.enabled ?? false,
    config,
    secretConfigKeys,
    environmentConfigKeys,
    overriddenEnvironmentConfigKeys,
    isConfigured: isConfiguredProvider(configFields, savedConfig),
  };
}
