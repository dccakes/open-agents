import { afterEach, describe, expect, test } from "bun:test";
import { authEnv, getMembershipConfig } from "@/lib/config/auth";

const TRACKED_KEYS = [
  "ALLOWED_EMAIL_DOMAINS",
  "ADMIN_EMAILS",
  "DEFAULT_ORG_NAME",
  "DEFAULT_ORG_SLUG",
] as const;

const originalValues = new Map(
  TRACKED_KEYS.map((key) => [key, process.env[key]]),
);

function setEnv(
  values: Partial<Record<(typeof TRACKED_KEYS)[number], string>>,
) {
  for (const key of TRACKED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of originalValues) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("getMembershipConfig", () => {
  test("parses the domain and email allowlists", () => {
    setEnv({
      ALLOWED_EMAIL_DOMAINS: "NextDegree.org, example.com",
      ADMIN_EMAILS: "Ada@NextDegree.org",
    });

    const config = getMembershipConfig();

    expect(config.allowedEmailDomains).toEqual([
      "nextdegree.org",
      "example.com",
    ]);
    expect(config.adminEmails).toEqual(["ada@nextdegree.org"]);
  });

  test("an unset domain allowlist auto-approves nobody", () => {
    setEnv({});

    expect(getMembershipConfig().allowedEmailDomains).toEqual([]);
  });

  test("an unset admin allowlist bootstraps nobody", () => {
    setEnv({});

    expect(getMembershipConfig().adminEmails).toEqual([]);
  });

  test("falls back to the default organization name and slug", () => {
    setEnv({});

    const config = getMembershipConfig();

    expect(config.defaultOrgName).toBe("QuackOps");
    expect(config.defaultOrgSlug).toBe("quackops");
  });

  test("normalizes a configured slug", () => {
    setEnv({ DEFAULT_ORG_NAME: " Next Degree ", DEFAULT_ORG_SLUG: " Acme " });

    const config = getMembershipConfig();

    expect(config.defaultOrgName).toBe("Next Degree");
    expect(config.defaultOrgSlug).toBe("acme");
  });
});

describe("authEnv membership specs", () => {
  test("ADMIN_EMAILS is required on a production deploy", () => {
    expect(authEnv.specs.ADMIN_EMAILS.axis).toBe("required-prod");
  });

  test("the domain allowlist is optional, so unset means nothing auto-approves", () => {
    expect(authEnv.specs.ALLOWED_EMAIL_DOMAINS.axis).toBe("optional");
  });

  test("the organization defaults are optional", () => {
    expect(authEnv.specs.DEFAULT_ORG_NAME.axis).toBe("optional");
    expect(authEnv.specs.DEFAULT_ORG_SLUG.axis).toBe("optional");
  });
});
