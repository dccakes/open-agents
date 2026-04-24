import { defaultRegistry } from "@open-agents/sandbox";
import { requireAuthenticatedUser } from "@/app/api/sessions/_lib/session-context";
import { getUserSandboxConfigs } from "@/lib/db/sandbox-configs";
import { buildSandboxProviderSettingsData } from "@/lib/sandbox-provider-settings";

export async function GET() {
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }

  const configs = await getUserSandboxConfigs(authResult.userId);
  const configsByProviderType = new Map(
    configs.map((config) => [config.providerType, config]),
  );

  const providers = defaultRegistry
    .list()
    .map((provider) =>
      buildSandboxProviderSettingsData(
        provider,
        configsByProviderType.get(provider.type),
      ),
    );

  return Response.json({ providers });
}
