/**
 * Server boot hook.
 *
 * Validating the config here means a deployment missing a required variable
 * fails at startup — naming the variable — instead of at the first request that
 * happens to need it.
 *
 * Seeding runs here too, for the reason it cannot run anywhere else: migrations
 * are static SQL and cannot read `DEFAULT_ORG_NAME` or `ADMIN_EMAILS`.
 */

import { validateServerConfig } from "@/lib/config/validate";
import { ensureSeededOrganization } from "@/lib/org/seed";

export async function register(): Promise<void> {
  // The edge runtime gets its own `register()` call with a different (and much
  // smaller) env surface; server config is validated once, on Node.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  validateServerConfig();

  try {
    const result = await ensureSeededOrganization();
    console.log(
      `[org] Seeded organization ${result.organizationId} (created: ${result.createdOrganization}, memberships: ${result.grantedMemberships}, sessions backfilled: ${result.backfilledSessions})`,
    );
  } catch (error) {
    // A failed seed must not take the deployment down: permission checks
    // resolve the organization explicitly and deny when it is missing, so the
    // degraded state is "nobody is authorized", not "everybody is".
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[org] Failed to seed the organization: ${message}`);
  }
}
