/**
 * Generate `apps/web/.env.example` from the config modules.
 *
 * The schemas in `lib/config/**` are the single source of truth for what
 * variables exist; this renders them, grouped by concern, with the axis and
 * description attached. Secrets are emitted blank.
 *
 * Usage:  bun run scripts/generate-env-example.ts        # write the file
 *         bun run scripts/generate-env-example.ts --check # fail if stale
 */

import { join } from "node:path";
import { renderEnvExample } from "@/lib/config/env-example";

const targetPath = join(import.meta.dirname, "..", ".env.example");
const rendered = renderEnvExample();

if (process.argv.includes("--check")) {
  const current = await Bun.file(targetPath)
    .text()
    .catch(() => null);

  if (current !== rendered) {
    console.error(
      ".env.example is out of date. Run: bun run --cwd apps/web env:example",
    );
    process.exit(1);
  }

  console.log(".env.example matches the config schemas.");
} else {
  await Bun.write(targetPath, rendered);
  console.log(`Wrote ${targetPath}`);
}
