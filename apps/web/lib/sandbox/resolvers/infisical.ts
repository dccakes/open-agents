import { getSandboxEnvResolverConfig } from "@/lib/config/sandbox";
import type { EnvResolveOptions, EnvResolver } from "../env-resolver";

interface InfisicalSecret {
  key?: string;
  value?: string;
  environment?: string;
}

interface InfisicalEnvResolverDeps {
  fetchSecrets?: (opts: {
    projectId?: string;
    environment?: string;
  }) => Promise<InfisicalSecret[]>;
}

export class InfisicalEnvResolver implements EnvResolver {
  private readonly fetchSecrets: NonNullable<
    InfisicalEnvResolverDeps["fetchSecrets"]
  >;

  constructor(deps?: InfisicalEnvResolverDeps) {
    this.fetchSecrets =
      deps?.fetchSecrets ?? this.defaultFetchSecrets.bind(this);
  }

  private async defaultFetchSecrets(opts: {
    projectId?: string;
    environment?: string;
  }): Promise<InfisicalSecret[]> {
    const config = getSandboxEnvResolverConfig();
    const token = config.infisicalToken;
    const projectId = opts.projectId ?? config.infisicalProjectId;
    if (!token || !projectId) {
      throw new Error(
        "Infisical env resolver requires INFISICAL_TOKEN and INFISICAL_PROJECT_ID.",
      );
    }

    const environment = opts.environment ?? "production";
    const baseUrl = config.infisicalBaseUrl ?? "https://app.infisical.com";
    const query = new URLSearchParams({
      workspaceId: projectId,
      environment,
      recursive: "true",
      include_imports: "true",
    });

    const response = await fetch(
      `${baseUrl}/api/v3/secrets/raw?${query.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Infisical env fetch failed: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as {
      secrets?: Array<{
        secretKey?: string;
        secretValue?: string;
        environment?: string;
      }>;
    };

    return (payload.secrets ?? []).map((secret) => ({
      key: secret.secretKey,
      value: secret.secretValue,
      environment: secret.environment,
    }));
  }

  async resolve(opts: EnvResolveOptions): Promise<Record<string, string>> {
    const targetEnvironment = (opts.environment ?? "production").toLowerCase();
    const secrets = await this.fetchSecrets({
      projectId: opts.projectId,
      environment: targetEnvironment,
    });
    const denylist = new Set(opts.denylist);
    const result: Record<string, string> = {};

    for (const secret of secrets) {
      if (typeof secret.key !== "string" || typeof secret.value !== "string") {
        continue;
      }

      if (denylist.has(secret.key)) {
        continue;
      }

      const secretEnvironment = secret.environment?.toLowerCase();
      if (secretEnvironment && secretEnvironment !== targetEnvironment) {
        continue;
      }

      result[secret.key] = secret.value;
    }

    return result;
  }
}
