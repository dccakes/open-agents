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
  const provider = defaultRegistry.get(providerType as SandboxProviderType);
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
