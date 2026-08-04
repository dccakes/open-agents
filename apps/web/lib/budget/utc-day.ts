/**
 * The day boundary the organization budget is measured against.
 *
 * UTC midnight, matching how `getUsageHistory` already groups usage. Stated in
 * one place and surfaced in the UI verbatim, because a team that reads "daily"
 * as local midnight will be surprised exactly once a day, every day.
 */

/** The instant the current UTC day began. */
export function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** The sentence the UI shows wherever the daily budget appears. */
export const UTC_DAY_BOUNDARY_NOTICE =
  "The daily budget resets at UTC midnight, not at local midnight.";
