/**
 * Audit trail for impersonation.
 *
 * Impersonation is the single most powerful thing the admin plugin exposes: it
 * mints a session as another user. The plugin restricts *who* may do it (only
 * the platform `admin` role holds `user.impersonate`), but it records nothing,
 * so without this there is no answer to "who was acting as whom, and when".
 *
 * Registered as a request-level `after` hook for the same reason the last-admin
 * guard is a `before` hook: `/admin/impersonate-user` and
 * `/admin/stop-impersonating` offer no hooks of their own, and a chokepoint
 * beats auditing each future call site.
 */

import { APIError, createAuthMiddleware } from "better-auth/api";
import { recordAuditEvent } from "@/lib/audit/record";

const IMPERSONATE_PATH = "/admin/impersonate-user";
const STOP_IMPERSONATING_PATH = "/admin/stop-impersonating";

function readString(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null) {
    return null;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readNested(source: unknown, ...keys: string[]): unknown {
  let current = source;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Who initiated the impersonation.
 *
 * Read from `session.impersonatedBy`, which the admin plugin stamps on the
 * session it mints — the one field that survives both the start and the stop.
 */
function readImpersonator(context: unknown): string | null {
  return (
    readString(
      readNested(context, "newSession", "session"),
      "impersonatedBy",
    ) ?? readString(readNested(context, "session", "session"), "impersonatedBy")
  );
}

export const impersonationAudit = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== IMPERSONATE_PATH && ctx.path !== STOP_IMPERSONATING_PATH) {
    return;
  }

  // A refused attempt is not an impersonation; the plugin already answered 403.
  if (ctx.context.returned instanceof APIError) {
    return;
  }

  recordAuditEvent({
    action:
      ctx.path === IMPERSONATE_PATH
        ? "impersonation.started"
        : "impersonation.stopped",
    actorId: readImpersonator(ctx.context),
    targetId:
      readString(ctx.body, "userId") ??
      readString(readNested(ctx.context, "newSession", "user"), "id"),
  });
});
