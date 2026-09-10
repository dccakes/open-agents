/**
 * Structural enforcement of the last-admin invariants.
 *
 * Mounting the admin plugin exposes `/admin/set-role`, `/admin/ban-user`, and
 * `/admin/remove-user`, none of which offer a before-hook of their own. A
 * request-level `before` middleware is therefore the only place these can be
 * refused without auditing each future call site — the same reason enforcement
 * elsewhere in this change sits at a chokepoint rather than in a checklist.
 *
 * The organization plugin's own member endpoints are covered by
 * `organizationHooks` in `lib/auth/plugins.ts`, not here.
 */

import { createAuthMiddleware } from "better-auth/api";
import {
  ensureNotLastOrganizationAdmin,
  ensureNotLastPlatformAdmin,
} from "@/lib/org/admin-invariants";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

/** Endpoints that strip a role, and how to read the target from the body. */
const GUARDED_PATHS = new Set([
  "/admin/set-role",
  "/admin/ban-user",
  "/admin/remove-user",
]);

function readUserId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const { userId } = body as { userId?: unknown };
  return typeof userId === "string" ? userId : undefined;
}

/**
 * The role a `/admin/set-role` call would leave the user with.
 *
 * Better Auth accepts a single role or an array; both normalize to the
 * comma-separated form the invariant helpers parse.
 */
function readNextRole(path: string, body: unknown): string | undefined {
  if (path !== "/admin/set-role") {
    return undefined;
  }

  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  const { role } = body as { role?: unknown };
  if (typeof role === "string") {
    return role;
  }
  if (Array.isArray(role) && role.every((entry) => typeof entry === "string")) {
    return role.join(",");
  }

  return undefined;
}

export const lastAdminGuard = createAuthMiddleware(async (ctx) => {
  if (!GUARDED_PATHS.has(ctx.path)) {
    return;
  }

  const userId = readUserId(ctx.body);
  if (!userId) {
    return;
  }

  const nextRole = readNextRole(ctx.path, ctx.body);

  await ensureNotLastPlatformAdmin({ userId, nextRole });

  // Banning or deleting a user also strips their organization role; changing
  // their platform role does not.
  if (ctx.path === "/admin/set-role") {
    return;
  }

  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    return;
  }

  await ensureNotLastOrganizationAdmin({ organizationId, userId });
});
