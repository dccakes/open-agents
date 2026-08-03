/**
 * Server boot hook.
 *
 * Validating the config here means a deployment missing a required variable
 * fails at startup — naming the variable — instead of at the first request that
 * happens to need it.
 */

import { validateServerConfig } from "@/lib/config/validate";

export function register(): void {
  // The edge runtime gets its own `register()` call with a different (and much
  // smaller) env surface; server config is validated once, on Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  validateServerConfig();
}
