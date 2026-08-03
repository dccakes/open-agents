import { getSandboxEnvResolverConfig } from "@/lib/config/sandbox";
import type { EnvResolveOptions, EnvResolver } from "../env-resolver";

interface VercelEnvVar {
  key?: string;
  value?: string;
  target?: string | string[];
}

interface VercelEnvResolverDeps {
  fetchVars?: (opts: {
    projectId?: string;
    environment?: string;
  }) => Promise<VercelEnvVar[]>;
}

const DEFAULT_DENYLIST = [
  "VERCEL_TOKEN",
  "VERCEL_ACCESS_TOKEN",
  "GITHUB_TOKEN",
  "NX_CLOUD_ACCESS_TOKEN",
];

function normalizeTargets(target: string | string[] | undefined): string[] {
  if (Array.isArray(target)) {
    return target
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.toLowerCase());
  }

  if (typeof target === "string") {
    return [target.toLowerCase()];
  }

  return [];
}

export class VercelEnvResolver implements EnvResolver {
  private readonly fetchVars: NonNullable<VercelEnvResolverDeps["fetchVars"]>;

  constructor(deps?: VercelEnvResolverDeps) {
    this.fetchVars = deps?.fetchVars ?? this.defaultFetchVars.bind(this);
  }

  private async defaultFetchVars(opts: {
    projectId?: string;
    environment?: string;
  }): Promise<VercelEnvVar[]> {
    const config = getSandboxEnvResolverConfig();
    const token = config.vercelAccessToken;
    const projectId = opts.projectId ?? config.vercelProjectId;

    if (!token || !projectId) {
      return [];
    }

    const target = opts.environment ?? "production";
    const query = new URLSearchParams({
      decrypt: "true",
      target,
    });

    const url = `https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}/env?${query.toString()}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Vercel env fetch failed: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as { envs?: VercelEnvVar[] };
    return payload.envs ?? [];
  }

  async resolve(opts: EnvResolveOptions): Promise<Record<string, string>> {
    const targetEnvironment = (opts.environment ?? "production").toLowerCase();
    const vars = await this.fetchVars({
      projectId: opts.projectId,
      environment: targetEnvironment,
    });

    const denylist = new Set([...DEFAULT_DENYLIST, ...(opts.denylist ?? [])]);
    const result: Record<string, string> = {};

    for (const variable of vars) {
      if (
        typeof variable.key !== "string" ||
        typeof variable.value !== "string"
      ) {
        continue;
      }

      if (denylist.has(variable.key)) {
        continue;
      }

      const targets = normalizeTargets(variable.target);
      if (targets.length > 0 && !targets.includes(targetEnvironment)) {
        continue;
      }

      result[variable.key] = variable.value;
    }

    return result;
  }
}
