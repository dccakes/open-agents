/**
 * Every config group in one list.
 *
 * Boot validation and `.env.example` generation both read from here, so a new
 * group is documented and validated the moment it is registered.
 */

import { agentPolicyEnv } from "@/lib/config/agent-policy";
import { authEnv } from "@/lib/config/auth";
import { dbEnv } from "@/lib/config/db";
import { deploymentEnv } from "@/lib/config/deployment";
import type { EnvGroup, EnvVarSpec } from "@/lib/config/env-group";
import { githubEnv } from "@/lib/config/github";
import { linearEnv } from "@/lib/config/linear";
import { publicEnv } from "@/lib/config/public";
import { redisEnv } from "@/lib/config/redis";
import { sandboxEnv } from "@/lib/config/sandbox";

export const configGroups: EnvGroup[] = [
  deploymentEnv,
  publicEnv,
  authEnv,
  dbEnv,
  githubEnv,
  linearEnv,
  redisEnv,
  sandboxEnv,
  agentPolicyEnv,
];

export interface CatalogEntry {
  name: string;
  group: string;
  spec: EnvVarSpec;
}

/** Flattened catalog of declared variables, in group then declaration order. */
export function getEnvCatalog(): CatalogEntry[] {
  return configGroups.flatMap((group) =>
    Object.entries(group.specs).map(([name, spec]) => ({
      name,
      group: group.name,
      spec,
    })),
  );
}
