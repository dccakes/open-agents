/**
 * Drift check between the config catalog and `turbo.json`'s build env list.
 *
 * Turborepo runs in strict env mode, so a variable the `build` task does not
 * declare is *stripped* before `next build` sees it — even when the Vercel
 * project sets it. A variable declared in `lib/config/**` but missing here is
 * therefore invisible at build time, and `scripts/check-env.ts` fails the
 * deploy claiming it is unset. `ADMIN_EMAILS` did exactly that.
 *
 * The check is one-directional on purpose. `turbo.json` legitimately lists
 * platform-provided variables the app never reads through a config group —
 * the Neon integration's `POSTGRES_*`/`PG*` aliases, `KV_*`, `BLOB_*` — and
 * those are not catalog drift.
 */

import { join } from "node:path";
import { getEnvCatalog } from "@/lib/config/registry";

const turboConfigPath = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "turbo.json",
);

interface TurboConfig {
  tasks: Record<string, { env?: string[] }>;
}

/** Variables the `build` task passes through to the app. */
export async function readTurboBuildEnv(): Promise<string[]> {
  const contents = await Bun.file(turboConfigPath).text();
  const config = JSON.parse(contents) as TurboConfig;

  return config.tasks.build.env ?? [];
}

/** Declared variables that `turbo.json` would strip from a build. */
export async function findUndeclaredBuildEnv(): Promise<string[]> {
  const buildEnv = new Set(await readTurboBuildEnv());

  return getEnvCatalog()
    .map((entry) => entry.name)
    .filter((name) => !buildEnv.has(name));
}
