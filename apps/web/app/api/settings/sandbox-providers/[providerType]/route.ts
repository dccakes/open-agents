import { isIP } from "node:net";
import {
  defaultRegistry,
  type SandboxProviderType,
} from "@open-agents/sandbox";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { upsertUserSandboxConfig } from "@/lib/db/sandbox-configs";
import { buildSandboxProviderSettingsData } from "@/lib/sandbox-provider-settings";

interface UpdateSandboxProviderRequest {
  enabled?: boolean;
  config?: Record<string, unknown>;
}

function isSandboxProviderType(value: string): value is SandboxProviderType {
  return defaultRegistry.list().some((provider) => provider.type === value);
}

function isPrivateOrLoopbackIpv4(hostname: string): boolean {
  const [a, b] = hostname.split(".").map(Number);
  if (
    Number.isNaN(a) ||
    Number.isNaN(b) ||
    a < 0 ||
    a > 255 ||
    b < 0 ||
    b > 255
  ) {
    return false;
  }

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateOrLoopbackIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function validateDaytonaServerUrl(value: string): string | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedValue);
  } catch {
    return "DAYTONA_SERVER_URL must be a valid URL";
  }

  if (parsedUrl.protocol !== "https:") {
    return "DAYTONA_SERVER_URL must use https";
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "DAYTONA_SERVER_URL cannot target localhost";
  }

  const ipVersion = isIP(hostname);
  if (
    (ipVersion === 4 && isPrivateOrLoopbackIpv4(hostname)) ||
    (ipVersion === 6 && isPrivateOrLoopbackIpv6(hostname))
  ) {
    return "DAYTONA_SERVER_URL cannot target private or loopback IP addresses";
  }

  return null;
}

function parseConfigPatch(
  config: Record<string, unknown>,
): Record<string, string> | null {
  const configPatch: Record<string, string> = {};

  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") {
      return null;
    }

    configPatch[key] = value;
  }

  return configPatch;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ providerType: string }> },
) {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { providerType } = await params;
  if (!isSandboxProviderType(providerType)) {
    return Response.json(
      { error: "Unknown sandbox provider" },
      { status: 404 },
    );
  }
  const provider = defaultRegistry.get(providerType);
  if (!provider) {
    return Response.json(
      { error: "Unknown sandbox provider" },
      { status: 404 },
    );
  }

  let body: UpdateSandboxProviderRequest;
  try {
    body = (await req.json()) as UpdateSandboxProviderRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return Response.json({ error: "Invalid enabled value" }, { status: 400 });
  }

  let configPatch: Record<string, string> | undefined;
  if (body.config !== undefined) {
    if (
      !body.config ||
      typeof body.config !== "object" ||
      Array.isArray(body.config)
    ) {
      return Response.json(
        { error: "Invalid config payload" },
        { status: 400 },
      );
    }

    const parsedConfig = parseConfigPatch(body.config);
    if (!parsedConfig) {
      return Response.json(
        { error: "Invalid config payload" },
        { status: 400 },
      );
    }

    if (provider.type === "daytona") {
      const daytonaServerUrlError = validateDaytonaServerUrl(
        parsedConfig.DAYTONA_SERVER_URL ?? "",
      );
      if (daytonaServerUrlError) {
        return Response.json({ error: daytonaServerUrlError }, { status: 400 });
      }
    }

    configPatch = parsedConfig;
  }

  if (body.enabled === undefined && configPatch === undefined) {
    return Response.json(
      { error: "At least one of enabled or config is required" },
      { status: 400 },
    );
  }

  if (body.enabled === true && !provider.isAvailable()) {
    return Response.json(
      {
        error:
          provider.reasonUnavailable() ??
          `Provider '${provider.type}' is currently unavailable`,
      },
      { status: 400 },
    );
  }

  const updatedConfig = await upsertUserSandboxConfig(
    authResult.userId,
    provider.type,
    {
      enabled: body.enabled,
      config: configPatch,
    },
  );

  const providerData = buildSandboxProviderSettingsData(
    provider,
    updatedConfig,
  );

  return Response.json({ provider: providerData });
}
