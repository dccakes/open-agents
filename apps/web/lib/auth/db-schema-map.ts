/**
 * Model name → Drizzle table, handed to `drizzleAdapter`.
 *
 * The keys are the *resolved* Better Auth model names (after each plugin's
 * `modelName` remapping), because that is what the adapter looks up. Drizzle
 * stays the source of truth for the schema; the Better Auth CLI generator is
 * not used.
 */

import * as schema from "@/lib/db/schema";

export const authDbSchemaMap = {
  users: schema.users,
  auth_sessions: schema.authSessions,
  account: schema.accounts,
  verification: schema.verification,
  organizations: schema.organizations,
  org_members: schema.orgMembers,
  org_invitations: schema.orgInvitations,
} as const;

export type AuthDbSchemaMap = typeof authDbSchemaMap;
