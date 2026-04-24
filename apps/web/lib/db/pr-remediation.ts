import { and, eq, sql } from "drizzle-orm";
import { db } from "./client";
import {
  prRemediationLeases,
  prRemediationStates,
  webhookDeliveries,
} from "./schema";
import {
  REMEDIATION_STATUS,
  type RemediationStatus,
} from "@/lib/pr-remediation/safety-controls";

type UpsertRemediationStateInput = {
  id?: string;
  sessionId: string;
  prNumber: number;
  headSha: string;
  attemptCount?: number;
  lastAttemptAt?: Date | null;
  lastFingerprintHash?: string | null;
  status?: RemediationStatus;
  watcherRunId?: string | null;
};

function buildRemediationStateId(
  sessionId: string,
  prNumber: number,
  headSha: string,
): string {
  return `${sessionId}:${prNumber}:${headSha}`;
}

export async function claimWatcherLease(
  sessionId: string,
  prNumber: number,
  runId: string,
): Promise<boolean> {
  const [inserted] = await db
    .insert(prRemediationLeases)
    .values({
      sessionId,
      prNumber,
      watcherRunId: runId,
      claimedAt: new Date(),
    })
    .onConflictDoNothing({
      target: prRemediationLeases.sessionId,
    })
    .returning({ sessionId: prRemediationLeases.sessionId });

  if (inserted) {
    return true;
  }

  const existing = await db.query.prRemediationLeases.findFirst({
    where: eq(prRemediationLeases.sessionId, sessionId),
  });

  return Boolean(
    existing &&
    existing.prNumber === prNumber &&
    existing.watcherRunId === runId,
  );
}

export async function releaseWatcherLease(
  sessionId: string,
  prNumber: number,
  runId: string,
): Promise<void> {
  await db
    .delete(prRemediationLeases)
    .where(
      and(
        eq(prRemediationLeases.sessionId, sessionId),
        eq(prRemediationLeases.prNumber, prNumber),
        eq(prRemediationLeases.watcherRunId, runId),
      ),
    );
}

export async function getRemediationState(
  sessionId: string,
  prNumber: number,
  headSha: string,
) {
  return db.query.prRemediationStates.findFirst({
    where: and(
      eq(prRemediationStates.sessionId, sessionId),
      eq(prRemediationStates.prNumber, prNumber),
      eq(prRemediationStates.headSha, headSha),
    ),
  });
}

export async function upsertRemediationState(
  data: UpsertRemediationStateInput,
) {
  const now = new Date();
  const set: Partial<typeof prRemediationStates.$inferInsert> = {
    updatedAt: now,
  };

  if (data.attemptCount !== undefined) {
    set.attemptCount = data.attemptCount;
  }
  if (data.lastAttemptAt !== undefined) {
    set.lastAttemptAt = data.lastAttemptAt;
  }
  if (data.lastFingerprintHash !== undefined) {
    set.lastFingerprintHash = data.lastFingerprintHash;
  }
  if (data.status !== undefined) {
    set.status = data.status;
  }
  if (data.watcherRunId !== undefined) {
    set.watcherRunId = data.watcherRunId;
  }

  const [state] = await db
    .insert(prRemediationStates)
    .values({
      id:
        data.id ??
        buildRemediationStateId(data.sessionId, data.prNumber, data.headSha),
      sessionId: data.sessionId,
      prNumber: data.prNumber,
      headSha: data.headSha,
      attemptCount: data.attemptCount ?? 0,
      lastAttemptAt: data.lastAttemptAt,
      lastFingerprintHash: data.lastFingerprintHash,
      status: data.status ?? REMEDIATION_STATUS.watching,
      watcherRunId: data.watcherRunId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        prRemediationStates.sessionId,
        prRemediationStates.prNumber,
        prRemediationStates.headSha,
      ],
      set,
    })
    .returning();

  if (!state) {
    throw new Error("Failed to upsert PR remediation state");
  }

  return state;
}

export async function recordRemediationAttempt(
  sessionId: string,
  prNumber: number,
  headSha: string,
  fingerprintHash: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(prRemediationStates)
    .set({
      attemptCount: sql`${prRemediationStates.attemptCount} + 1`,
      lastAttemptAt: now,
      lastFingerprintHash: fingerprintHash,
      updatedAt: now,
    })
    .where(
      and(
        eq(prRemediationStates.sessionId, sessionId),
        eq(prRemediationStates.prNumber, prNumber),
        eq(prRemediationStates.headSha, headSha),
      ),
    );
}

export async function recordWebhookDeliveryIfNew(
  deliveryId: string,
): Promise<boolean> {
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({ deliveryId })
    .onConflictDoNothing({ target: webhookDeliveries.deliveryId })
    .returning({ deliveryId: webhookDeliveries.deliveryId });

  return Boolean(delivery);
}
