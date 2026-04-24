import { timingSafeEqual } from "crypto";
import { lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { webhookDeliveries } from "@/lib/db/schema";

const RETENTION_DAYS = 7;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
export const runtime = "nodejs";

type PruneWebhookDeliveriesSuccessResponse = {
  ok: true;
  deletedCount: number;
  retentionDays: number;
  prunedBefore: string;
};

type PruneWebhookDeliveriesErrorResponse = {
  ok: false;
  error: "cron_secret_not_configured" | "unauthorized" | "invalid_prune_cutoff";
};

function getBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);

  if (
    scheme?.toLowerCase() !== "bearer" ||
    !token ||
    token.trim().length === 0
  ) {
    return null;
  }

  return token;
}

function isAuthorizedCronRequest(
  request: Request,
  expectedSecret: string,
): boolean {
  const providedToken = getBearerToken(request.headers.get("authorization"));
  if (!providedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedToken);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(request: Request): Promise<Response> {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    const response: PruneWebhookDeliveriesErrorResponse = {
      ok: false,
      error: "cron_secret_not_configured",
    };
    return Response.json(response, { status: 500 });
  }

  if (!isAuthorizedCronRequest(request, expectedSecret)) {
    const response: PruneWebhookDeliveriesErrorResponse = {
      ok: false,
      error: "unauthorized",
    };
    return Response.json(response, { status: 401 });
  }

  const pruneBefore = new Date(Date.now() - RETENTION_DAYS * DAY_IN_MS);
  if (Number.isNaN(pruneBefore.getTime())) {
    const response: PruneWebhookDeliveriesErrorResponse = {
      ok: false,
      error: "invalid_prune_cutoff",
    };
    return Response.json(response, { status: 500 });
  }

  const deletedRows = await db
    .delete(webhookDeliveries)
    .where(lt(webhookDeliveries.processedAt, pruneBefore))
    .returning({ deliveryId: webhookDeliveries.deliveryId });

  const response: PruneWebhookDeliveriesSuccessResponse = {
    ok: true,
    deletedCount: deletedRows.length,
    retentionDays: RETENTION_DAYS,
    prunedBefore: pruneBefore.toISOString(),
  };

  return Response.json(response);
}
