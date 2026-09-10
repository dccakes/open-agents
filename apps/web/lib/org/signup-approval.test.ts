import { describe, expect, test } from "bun:test";
import {
  decideSignupApproval,
  type SignupApprovalConfig,
} from "@/lib/org/signup-approval";

const config: SignupApprovalConfig = {
  allowedEmailDomains: ["nextdegree.org", "example.com"],
  adminEmails: ["admin@nextdegree.org"],
};

describe("decideSignupApproval", () => {
  test("grants member to a verified allowlisted domain", () => {
    expect(
      decideSignupApproval(
        { email: "someone@nextdegree.org", emailVerified: true },
        config,
      ),
    ).toEqual({ organizationRole: "member", platformAdmin: false });
  });

  test("grants owner and platform admin to a verified ADMIN_EMAILS match", () => {
    expect(
      decideSignupApproval(
        { email: "admin@nextdegree.org", emailVerified: true },
        config,
      ),
    ).toEqual({ organizationRole: "owner", platformAdmin: true });
  });

  test("grants owner to an ADMIN_EMAILS match whose domain is not allowlisted", () => {
    expect(
      decideSignupApproval(
        { email: "founder@elsewhere.test", emailVerified: true },
        { allowedEmailDomains: [], adminEmails: ["founder@elsewhere.test"] },
      ),
    ).toEqual({ organizationRole: "owner", platformAdmin: true });
  });

  test("grants nothing to a non-allowlisted domain", () => {
    expect(
      decideSignupApproval(
        { email: "stranger@example.org", emailVerified: true },
        config,
      ),
    ).toBeNull();
  });

  test("grants nothing when the user has no email address", () => {
    expect(
      decideSignupApproval({ email: null, emailVerified: true }, config),
    ).toBeNull();
  });

  test("grants nothing when an allowlisted address is unverified", () => {
    expect(
      decideSignupApproval(
        { email: "someone@nextdegree.org", emailVerified: false },
        config,
      ),
    ).toBeNull();
  });

  // An unverified ADMIN_EMAILS match would be a full-takeover path: anyone able
  // to register that address at any OAuth provider would become an owner.
  test("grants nothing when an ADMIN_EMAILS match is unverified", () => {
    expect(
      decideSignupApproval(
        { email: "admin@nextdegree.org", emailVerified: false },
        config,
      ),
    ).toBeNull();
  });

  test("matches the domain case-insensitively", () => {
    expect(
      decideSignupApproval(
        { email: "Someone@NextDegree.ORG", emailVerified: true },
        config,
      ),
    ).toEqual({ organizationRole: "member", platformAdmin: false });
  });

  test("does not treat a subdomain as a match", () => {
    expect(
      decideSignupApproval(
        { email: "someone@mail.nextdegree.org", emailVerified: true },
        config,
      ),
    ).toBeNull();
  });

  test("does not treat a suffix collision as a match", () => {
    expect(
      decideSignupApproval(
        { email: "someone@notnextdegree.org", emailVerified: true },
        config,
      ),
    ).toBeNull();
  });

  // The fail-closed reading: an unconfigured allowlist auto-approves nobody.
  test("grants nothing when the allowlist is unset", () => {
    expect(
      decideSignupApproval(
        { email: "someone@nextdegree.org", emailVerified: true },
        { allowedEmailDomains: [], adminEmails: [] },
      ),
    ).toBeNull();
  });

  test("grants nothing for a malformed address with no domain part", () => {
    expect(
      decideSignupApproval(
        { email: "nextdegree.org", emailVerified: true },
        config,
      ),
    ).toBeNull();
  });

  test("grants nothing for an address with more than one @", () => {
    expect(
      decideSignupApproval(
        { email: "a@b@nextdegree.org", emailVerified: true },
        config,
      ),
    ).toBeNull();
  });
});
