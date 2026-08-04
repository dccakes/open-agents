import { beforeEach, describe, expect, mock, test } from "bun:test";

interface Row {
  id: string;
  installationId: number;
  accountId: number | null;
  accountLogin: string;
  organizationId: string | null;
}

let appInstallations: unknown[] = [];
let orgOwned: Row[] = [];
let missingAccountId: Row[] = [];

const deletedIds: string[][] = [];
const accountIdWrites: { id: string; accountId: number }[] = [];
const renames: { accountId: number; accountLogin: string }[] = [];

mock.module("@/lib/github/app", () => ({
  getAppOctokit: () => ({
    paginate: async () => appInstallations,
  }),
}));

mock.module("@/lib/db/installations", () => ({
  getAllOrgOwnedInstallations: async () => orgOwned,
  getInstallationsMissingAccountId: async () => missingAccountId,
  deleteInstallationsByIds: async (ids: string[]) => {
    deletedIds.push(ids);
    return ids.length;
  },
  setInstallationAccountId: async (id: string, accountId: number) => {
    accountIdWrites.push({ id, accountId });
  },
}));

mock.module("@/lib/db/org-github-accounts", () => ({
  renameOrgGitHubAccount: async (p: {
    accountId: number;
    accountLogin: string;
  }) => {
    renames.push(p);
  },
}));

const modulePromise = import("@/lib/github/reconcile-installations");

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "r1",
    installationId: 100,
    accountId: 4242,
    accountLogin: "next-degree",
    organizationId: "org-1",
    ...overrides,
  };
}

beforeEach(() => {
  appInstallations = [];
  orgOwned = [];
  missingAccountId = [];
  deletedIds.length = 0;
  accountIdWrites.length = 0;
  renames.length = 0;
});

describe("reconcileOrgInstallations", () => {
  test("removes an organization-owned record the App no longer holds", async () => {
    appInstallations = [];
    orgOwned = [row({ id: "stale", installationId: 100 })];
    const { reconcileOrgInstallations } = await modulePromise;

    const outcome = await reconcileOrgInstallations();

    expect(deletedIds).toEqual([["stale"]]);
    expect(outcome.removedInstallationIds).toEqual([100]);
  });

  test("keeps a record the App still holds", async () => {
    appInstallations = [
      { id: 100, account: { id: 4242, login: "next-degree" } },
    ];
    orgOwned = [row()];
    const { reconcileOrgInstallations } = await modulePromise;

    const outcome = await reconcileOrgInstallations();

    expect(deletedIds).toEqual([[]]);
    expect(outcome.removedInstallationIds).toEqual([]);
  });

  test("backfills a missing numeric account id from the App's view", async () => {
    appInstallations = [
      { id: 100, account: { id: 4242, login: "next-degree" } },
    ];
    missingAccountId = [row({ id: "needs-id", accountId: null })];
    const { reconcileOrgInstallations } = await modulePromise;

    const outcome = await reconcileOrgInstallations();

    expect(accountIdWrites).toEqual([{ id: "needs-id", accountId: 4242 }]);
    expect(outcome.backfilledAccountIdCount).toBe(1);
  });

  test("leaves a record alone when the App reports no account id", async () => {
    appInstallations = [{ id: 100, account: { login: "next-degree" } }];
    missingAccountId = [row({ id: "needs-id", accountId: null })];
    const { reconcileOrgInstallations } = await modulePromise;

    const outcome = await reconcileOrgInstallations();

    expect(accountIdWrites).toEqual([]);
    expect(outcome.backfilledAccountIdCount).toBe(0);
  });

  // A renamed account keeps its id and its ownership — only the display login
  // is behind. This is the reason the allowlist is keyed by id, not login.
  test("refreshes a claimed account's login after a rename", async () => {
    appInstallations = [
      { id: 100, account: { id: 4242, login: "nextdegree" } },
    ];
    orgOwned = [row({ accountLogin: "next-degree" })];
    const { reconcileOrgInstallations } = await modulePromise;

    const outcome = await reconcileOrgInstallations();

    expect(renames).toEqual([{ accountId: 4242, accountLogin: "nextdegree" }]);
    expect(outcome.renamedAccountCount).toBe(1);
  });

  test("does not rename when the login is unchanged", async () => {
    appInstallations = [
      { id: 100, account: { id: 4242, login: "next-degree" } },
    ];
    orgOwned = [row({ accountLogin: "next-degree" })];
    const { reconcileOrgInstallations } = await modulePromise;

    expect((await reconcileOrgInstallations()).renamedAccountCount).toBe(0);
    expect(renames).toEqual([]);
  });

  test("skips an unparseable entry rather than failing the whole run", async () => {
    appInstallations = [
      { unexpected: true },
      { id: 100, account: { id: 4242, login: "next-degree" } },
    ];
    orgOwned = [row()];
    const { reconcileOrgInstallations } = await modulePromise;

    const outcome = await reconcileOrgInstallations();

    expect(outcome.removedInstallationIds).toEqual([]);
  });
});
