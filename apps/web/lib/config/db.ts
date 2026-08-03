/**
 * Database connection.
 *
 * `lib/db/migrate.ts` and `drizzle.config.ts` read `POSTGRES_URL` directly:
 * both run outside the Next.js runtime (build step and drizzle-kit CLI), where
 * importing app modules is not possible. They stay on the boundary allowlist.
 */

import { defineEnvGroup } from "@/lib/config/env-group";
import { optionalRawString } from "@/lib/config/schemas";

export const dbEnv = defineEnvGroup({
  name: "database",
  specs: {
    POSTGRES_URL: {
      axis: "required-prod",
      secret: true,
      description:
        "Postgres connection string. Provided automatically by the Neon integration on Vercel.",
      schema: optionalRawString,
    },
  },
});

export interface DatabaseConfig {
  url?: string;
}

export function getDatabaseConfig(): DatabaseConfig {
  return { url: dbEnv.read().POSTGRES_URL };
}
