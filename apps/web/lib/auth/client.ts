import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  inferAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import { ac, organizationRoles, platformRoles } from "./permissions";
import type { auth } from "./config";

/**
 * The client plugins get the same access-control instance as the server, so
 * `checkRolePermission` agrees with the server's `hasPermission`. It is used
 * **only** to hide affordances — every control it hides is also checked
 * server-side, because hiding a button is not authorization.
 */
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<typeof auth>(),
    organizationClient({ ac, roles: organizationRoles }),
    adminClient({ ac, roles: platformRoles }),
  ],
});
