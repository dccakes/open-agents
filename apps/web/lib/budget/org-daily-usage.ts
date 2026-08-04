/**
 * What the organization has spent since UTC midnight.
 *
 * The query joins `usage_events` to `org_members` because the budget is an
 * organization limit and the events are attributed to users. It is bounded by
 * `usage_events_user_id_created_at_idx` — before that index existed, this was a
 * full table scan, which is why the budget had no consumer.
 *
 * There is deliberately no per-session variant: the run budget reads the run's
 * own persisted totals, not this table, so no `(session_id)` index is needed.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orgMembers, usageEvents } from "@/lib/db/schema";
import { startOfUtcDay } from "@/lib/budget/utc-day";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";
import { OrgSettingsError } from "@/lib/org/settings-errors";

/**
 * Total input plus output tokens spent by the organization's members today.
 *
 * @throws OrgSettingsError (`unavailable`) when the organization has not been
 * seeded — the caller decides what an unanswerable budget means, and every
 * caller in this change decides "refuse".
 */
export async function readOrgDailyTokenUsage(
  now: Date = new Date(),
): Promise<number> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    throw new OrgSettingsError(
      "unavailable",
      "The organization has not been seeded yet, so its daily usage cannot be summed.",
    );
  }

  const rows = await db
    .select({
      tokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)::double precision`,
    })
    .from(usageEvents)
    .innerJoin(orgMembers, eq(orgMembers.userId, usageEvents.userId))
    .where(
      and(
        eq(orgMembers.organizationId, organizationId),
        gte(usageEvents.createdAt, startOfUtcDay(now)),
      ),
    )
    // A group-less aggregate returns exactly one row; saying so keeps the
    // builder terminal rather than awaited mid-chain.
    .limit(1);

  return rows[0]?.tokens ?? 0;
}
