import { describe, expect, test } from "bun:test";
import { platformRoles } from "@/lib/auth/permissions";

/**
 * The admin plugin authorizes its endpoints by checking `users.role` against
 * these roles (`plugins/admin/has-permission.mjs`). These assertions are what
 * keeps a future edit to the statement set from quietly handing every signed-in
 * user the ability to impersonate, mint users, or reset passwords.
 */
const PLATFORM_ONLY_CAPABILITIES: Array<[string, Record<string, string[]>]> = [
  ["impersonate", { user: ["impersonate"] }],
  ["create users", { user: ["create"] }],
  ["set passwords", { user: ["set-password"] }],
  ["list users", { user: ["list"] }],
  ["set roles", { user: ["set-role"] }],
  ["ban", { user: ["ban"] }],
  ["list sessions", { session: ["list"] }],
  ["revoke sessions", { session: ["revoke"] }],
];

describe("platform-only admin capabilities", () => {
  test.each(PLATFORM_ONLY_CAPABILITIES)(
    "the platform admin role may %s",
    (_label, permissions) => {
      expect(platformRoles.admin.authorize(permissions).success).toBe(true);
    },
  );

  test.each(PLATFORM_ONLY_CAPABILITIES)(
    "an ordinary user may not %s",
    (_label, permissions) => {
      expect(platformRoles.user.authorize(permissions).success).toBe(false);
    },
  );

  // `allowImpersonatingAdmins` is off and no platform role holds the statement,
  // so an admin cannot impersonate another admin either.
  test("impersonating another admin is granted to nobody", () => {
    for (const role of Object.values(platformRoles)) {
      expect(role.authorize({ user: ["impersonate-admins"] }).success).toBe(
        false,
      );
    }
  });
});
