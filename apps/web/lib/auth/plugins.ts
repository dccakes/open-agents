/**
 * Better Auth plugin configuration.
 *
 * Kept out of `lib/auth/config.ts` so the schema-conformance test can build
 * the plugins from exactly the options the runtime uses — a test that
 * hand-rolled its own options would happily pass while production carried a
 * different model mapping.
 */

import { admin as adminPlugin } from "better-auth/plugins/admin";
import { organization as organizationPlugin } from "better-auth/plugins/organization";
import {
  ac,
  organizationRoles,
  PLATFORM_ADMIN_ROLE,
  PLATFORM_DEFAULT_ROLE,
  platformRoles,
} from "@/lib/auth/permissions";
import { ensureNotLastOrganizationAdmin } from "@/lib/org/admin-invariants";

export const organizationPluginOptions = {
  ac,
  roles: organizationRoles,
  // Exactly one organization exists and it is created by the boot seeder.
  allowUserToCreateOrganization: false,
  // The repo already overloads "team" (`linearTeamId`, `vercelTeamId`); a
  // third meaning would be actively confusing.
  teams: { enabled: false },
  // Roles are static and code-defined this phase.
  dynamicAccessControl: { enabled: false },
  // Drizzle stays the source of truth; the plugin models are remapped onto the
  // repo's table names rather than the plugin defaults.
  schema: {
    organization: { modelName: "organizations" },
    member: { modelName: "org_members" },
    invitation: { modelName: "org_invitations" },
  },
  organizationHooks: {
    beforeUpdateMemberRole: async ({
      member,
      newRole,
      organization,
    }: {
      member: { id: string };
      newRole: string;
      organization: { id: string };
    }) => {
      await ensureNotLastOrganizationAdmin({
        organizationId: organization.id,
        memberId: member.id,
        nextRole: newRole,
      });
    },
    beforeRemoveMember: async ({
      member,
      organization,
    }: {
      member: { id: string };
      organization: { id: string };
    }) => {
      await ensureNotLastOrganizationAdmin({
        organizationId: organization.id,
        memberId: member.id,
      });
    },
  },
} as const;

export const adminPluginOptions = {
  ac,
  roles: platformRoles,
  defaultRole: PLATFORM_DEFAULT_ROLE,
  adminRoles: [PLATFORM_ADMIN_ROLE],
};

/** Built fresh per call so the conformance test never shares plugin state. */
export function createAuthPlugins() {
  return [
    organizationPlugin(organizationPluginOptions),
    adminPlugin(adminPluginOptions),
  ];
}
