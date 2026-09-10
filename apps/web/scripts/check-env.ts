/**
 * Validate the environment before building.
 *
 * `instrumentation.ts` validates at server start, but Next.js does not call
 * `register()` during `next build` and Vercel never boots the server as part of
 * a deploy — so instrumentation alone would surface a missing variable on the
 * first request, not on the deploy. This step runs in the build environment,
 * which is where the deploy can still be failed.
 *
 * Enforcement is keyed on `VERCEL_ENV`, so preview builds (which legitimately
 * omit optional integrations) and local builds stay unaffected.
 *
 * Usage:  bun run scripts/check-env.ts
 */

import { validateServerConfig } from "@/lib/config/validate";

try {
  validateServerConfig();
  console.log("✓ Environment configuration is valid");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
