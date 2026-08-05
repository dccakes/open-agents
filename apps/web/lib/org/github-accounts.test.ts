import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import { OrgSettingsError } from "@/lib/org/settings-errors";

interface Row {
  id: string;
  userId: string;
  installationId: number;
  accountId: number | null;
  organizationId: string | null;
  createdAt: Date;
}

let permitted = true;
let organizationId: string | null = "org-1";
let byAccountId: Row[] = [];
let storedAccount: { accountId: number } | undefined;

const claimed: string[] = [];
const released: string[] = [];
const deleted: string[][] = [];
const addedAccounts: Record<string, unknown>[] = [];
const removedAccounts: number[] = [];

mock.module("@/lib/auth/require-permission", () => ({
  requireApprovedMember: () =>
    Promise.resolve({
      userId: "user-admin",
      organizationId: organizationId ?? "org-1",
      role: "admin",
    }),
  requirePermission: () => {
    if (!permitted) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve();
  },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => organizationId,
  requireSeededOrganizationId: async () => {
    if (!organizationId) {
      throw new OrgSettingsError("unavailable", "not seeded");
    }
    return organizationId;
  },
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationsByAccountId: async () => byAccountId,
  claimInstallationForOrganization: async (p: { id: string }) => {
    claimed.push(p.id);
  },
  releaseInstallationsFromOrganization: async (ids: string[]) => {
    released.push(...ids);
  },
  deleteInstallationsByIds: async (ids: string[]) => {
    deleted.push(ids);
    return ids.length;
  },
}));

mock.module("@/lib/db/org-github-accounts", () => ({
  addOrgGitHubAccount: async (p: Record<string, unknown>) => {
    addedAccounts.push(p);
    return { id: "acc-1", ...p };
  },
  getOrgGitHubAccount: async () => storedAccount,
  listOrgGitHubAccounts: async () => [],
  removeOrgGitHubAccount: async (_org: string, accountId: number) => {
    removedAccounts.push(accountId);
    return true;
  },
}));

const modulePromise = import("@/lib/org/github-accounts");

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "r1",
    userId: "u1",
    installationId: 100,
    accountId: 4242,
    organizationId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const ORG_ACCOUNT = {
  accountId: 4242,
  accountLogin: "next-degree",
  accountType: "Organization" as const,
};

beforeEach(() => {
  permitted = true;
  organizationId = "org-1";
  byAccountId = [];
  storedAccount = { accountId: 4242 };
  claimed.length = 0;
  released.length = 0;
  deleted.length = 0;
  addedAccounts.length = 0;
  removedAccounts.length = 0;
});

describe("claimGitHubAccount", () => {
  test("refuses a caller without integration.connect and promotes nothing", async () => {
    permitted = false;
    byAccountId = [row()];
    const { claimGitHubAccount } = await modulePromise;

    await expect(claimGitHubAccount(ORG_ACCOUNT)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(addedAccounts).toEqual([]);
    expect(claimed).toEqual([]);
  });

  test("refuses a personal GitHub account", async () => {
    const { claimGitHubAccount } = await modulePromise;

    await expect(
      claimGitHubAccount({ ...ORG_ACCOUNT, accountType: "User" }),
    ).rejects.toMatchObject({ name: "OrgSettingsError", kind: "invalid" });
    expect(addedAccounts).toEqual([]);
  });

  test("collapses duplicate records onto one organization-owned record", async () => {
    byAccountId = [
      row({ id: "a", userId: "u1", createdAt: new Date("2026-01-01") }),
      row({ id: "b", userId: "u2", createdAt: new Date("2026-02-01") }),
      row({ id: "c", userId: "u3", createdAt: new Date("2026-03-01") }),
    ];
    const { claimGitHubAccount } = await modulePromise;

    const outcome = await claimGitHubAccount(ORG_ACCOUNT);

    expect(claimed).toEqual(["a"]);
    expect(deleted).toEqual([["b", "c"]]);
    expect(outcome.removedRecordCount).toBe(2);
    expect(outcome.promotedInstallationIds).toEqual([100]);
  });

  test("is a no-op when re-run against an already-promoted account", async () => {
    byAccountId = [row({ id: "a", organizationId: "org-1" })];
    const { claimGitHubAccount } = await modulePromise;

    const outcome = await claimGitHubAccount(ORG_ACCOUNT);

    expect(claimed).toEqual([]);
    expect(outcome.removedRecordCount).toBe(0);
  });
});

describe("releaseGitHubAccount", () => {
  test("refuses a caller without integration.disconnect", async () => {
    permitted = false;
    const { releaseGitHubAccount } = await modulePromise;

    await expect(releaseGitHubAccount(4242)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(released).toEqual([]);
    expect(removedAccounts).toEqual([]);
  });

  test("returns the account's installations to personal ownership", async () => {
    byAccountId = [
      row({ id: "ours", organizationId: "org-1", accountId: 4242 }),
      // A record on the same account that another organization owns must not
      // be released by this organization's admin.
      row({
        id: "other-org",
        organizationId: "org-2",
        accountId: 4242,
        installationId: 200,
      }),
    ];
    const { releaseGitHubAccount } = await modulePromise;

    const outcome = await releaseGitHubAccount(4242);

    // Only the released account's installations move.
    expect(released).toEqual(["ours"]);
    expect(outcome.releasedInstallationIds).toEqual([100]);
    expect(removedAccounts).toEqual([4242]);
  });

  test("does nothing for an account that was never claimed", async () => {
    storedAccount = undefined;
    const { releaseGitHubAccount } = await modulePromise;

    const outcome = await releaseGitHubAccount(1234);

    expect(outcome.releasedInstallationIds).toEqual([]);
    expect(removedAccounts).toEqual([]);
  });
});
