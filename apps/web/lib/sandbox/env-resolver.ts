import { getSandboxEnvResolverConfig } from "@/lib/config/sandbox";
import { InfisicalEnvResolver } from "./resolvers/infisical";
import { VercelEnvResolver } from "./resolvers/vercel";

export interface EnvResolveOptions {
  projectId?: string;
  environment?: string;
  denylist?: string[];
}

export interface EnvResolver {
  resolve(opts: EnvResolveOptions): Promise<Record<string, string>>;
}

export function getEnvResolver(): EnvResolver | null {
  const { backend } = getSandboxEnvResolverConfig();

  if (!backend) {
    return null;
  }

  if (backend === "vercel") {
    return new VercelEnvResolver();
  }

  if (backend === "infisical") {
    return new InfisicalEnvResolver();
  }

  throw new Error(
    `Unknown SANDBOX_ENV_RESOLVER: ${backend}. Supported: vercel, infisical`,
  );
}
