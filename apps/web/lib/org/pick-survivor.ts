/**
 * Choosing which of several rows becomes the organization's.
 *
 * Both promotion planners collapse N per-user rows onto one org-owned row, and
 * they must agree on *which* row — not for tidiness, but because the whole
 * migration is expected to be replayed: preview deployments fork production and
 * re-run it, and an admin who removes and re-adds an account runs it again. A
 * rule that picked differently on the second run would move ownership between
 * rows and churn the partial unique index.
 *
 * Stating the rule once means a refinement to it cannot land in one planner and
 * silently miss the other.
 */

export interface OwnableRecord {
  organizationId: string | null;
  createdAt: Date;
}

/**
 * The row that survives a collapse, in three stages:
 *
 * 1. An already-org-owned row always wins, so a re-run is a no-op rather than a
 *    move.
 * 2. Otherwise the earliest row, whose user is the closest thing to the actual
 *    installer — every later row is a copy created by someone else's sync.
 * 3. Otherwise the lowest `tiebreak` value, so rows sharing a timestamp resolve
 *    identically on a preview fork and on production.
 *
 * @param tiebreak a stable per-record string; ties are broken on its ordering.
 */
export function pickSurvivor<T extends OwnableRecord>(
  records: [T, ...T[]],
  tiebreak: (record: T) => string,
): T {
  return records.reduce((winner, candidate) => {
    const candidateOwned = candidate.organizationId !== null;
    const winnerOwned = winner.organizationId !== null;

    if (candidateOwned !== winnerOwned) {
      return candidateOwned ? candidate : winner;
    }

    const delta = candidate.createdAt.getTime() - winner.createdAt.getTime();
    if (delta !== 0) {
      return delta < 0 ? candidate : winner;
    }

    return tiebreak(candidate) < tiebreak(winner) ? candidate : winner;
  });
}

/**
 * Group records by a key, preserving insertion order of the keys.
 *
 * Both planners need this immediately before `pickSurvivor`, and writing it
 * twice was how the two group-then-collapse loops drifted apart in shape.
 */
export function groupBy<T, K>(
  records: T[],
  key: (record: T) => K,
): Map<K, [T, ...T[]]> {
  const groups = new Map<K, [T, ...T[]]>();

  for (const record of records) {
    const groupKey = key(record);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.push(record);
    } else {
      groups.set(groupKey, [record]);
    }
  }

  return groups;
}
