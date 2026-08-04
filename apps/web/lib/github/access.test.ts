/**
 * Pinning tests for the claim that org-owned installations do not widen access.
 *
 * The claim is: because step 1 checks the *caller's own* GitHub credentials
 * and runs unconditionally before the installation is resolved, making step 2
 * organization-scoped cannot grant anyone a repository they could not already
 * reach. These tests exist so that claim fails loudly if the order is ever
 * changed — an org-owned installation covering the repository is present in
 * every denial case below, and must not rescue any of them.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

interface RepoResponse {
  id: number;
  default_branch: string;
  permissions?: { admin: boolean; maintain?: boolean; push: boolean };
}

const state: {
  userOctokit: {
    rest: { repos: { get: (args: unknown) => Promise<unknown> } };
  } | null;
  orgInstallation: { installationId: number } | undefined;
  personalInstallation: { installationId: number } | undefined;
  scopedCalls: number;
  scopedThrows: { status: number } | null;
} = {
  userOctokit: null,
  orgInstallation: undefined,
  personalInstallation: undefined,
  scopedCalls: 0,
  scopedThrows: null,
};

function userOctokitReturning(repo: RepoResponse) {
  return {
    rest: {
      repos: {
        get: () => Promise.resolve({ data: repo }),
      },
    },
  };
}

function userOctokitThrowing(status: number) {
  return {
    rest: {
      repos: {
        get: () => Promise.reject(Object.assign(new Error("gh"), { status })),
      },
    },
  };
}

mock.module("@/lib/github/client", () => ({
  getUserOctokit: () => Promise.resolve(state.userOctokit),
}));

mock.module("@/lib/github/app", () => ({
  withScopedInstallationOctokit: (params: {
    operation: (octokit: unknown) => Promise<unknown>;
  }) => {
    state.scopedCalls += 1;
    if (state.scopedThrows) {
      return Promise.reject(
        Object.assign(new Error("gh"), { status: state.scopedThrows.status }),
      );
    }
    return params.operation({
      rest: { repos: { get: () => Promise.resolve({ data: {} }) } },
    });
  },
}));

mock.module("@/lib/db/installations", () => ({
  getOrgInstallationByAccountLogin: () =>
    Promise.resolve(state.orgInstallation),
  getInstallationByAccountLogin: () =>
    Promise.resolve(state.personalInstallation),
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: () => Promise.resolve("org-1"),
}));

const { verifyRepoAccess } = await import("@/lib/github/access");

const READABLE: RepoResponse = {
  id: 555,
  default_branch: "main",
  permissions: { admin: false, push: false },
};

const WRITABLE: RepoResponse = {
  id: 555,
  default_branch: "main",
  permissions: { admin: false, push: true },
};

beforeEach(() => {
  state.userOctokit = userOctokitReturning(WRITABLE);
  // Present in every case below: the organization owns an installation that
  // covers this repository. It must never be what decides the outcome.
  state.orgInstallation = { installationId: 900 };
  state.personalInstallation = undefined;
  state.scopedCalls = 0;
  state.scopedThrows = null;
});

afterEach(() => {
  state.scopedCalls = 0;
});

describe("verifyRepoAccess — authorization stays the caller's own access", () => {
  test("denies a user who cannot see the repository, despite an org installation", async () => {
    state.userOctokit = userOctokitThrowing(404);

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "next-degree",
      repo: "quack-ops",
    });

    expect(result).toEqual({ ok: false, reason: "user_no_access" });
    // No installation token was minted for a repository the user cannot see.
    expect(state.scopedCalls).toBe(0);
  });

  test("denies a read-only collaborator on a write action, despite an org installation", async () => {
    state.userOctokit = userOctokitReturning(READABLE);

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "next-degree",
      repo: "quack-ops",
      requiredUserPermission: "write",
    });

    expect(result).toEqual({ ok: false, reason: "user_no_write" });
    expect(state.scopedCalls).toBe(0);
  });

  test("denies a user with no linked GitHub credentials, despite an org installation", async () => {
    state.userOctokit = null;

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "next-degree",
      repo: "quack-ops",
    });

    expect(result).toEqual({ ok: false, reason: "no_user_token" });
    expect(state.scopedCalls).toBe(0);
  });

  test("denies when the installation does not cover the repository", async () => {
    state.scopedThrows = { status: 404 };

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "next-degree",
      repo: "quack-ops",
    });

    expect(result).toEqual({ ok: false, reason: "app_no_access" });
  });
});

describe("verifyRepoAccess — organization-scoped resolution", () => {
  test("resolves the organization's installation for a member with no personal record", async () => {
    state.personalInstallation = undefined;

    const result = await verifyRepoAccess({
      userId: "member-who-never-synced",
      owner: "next-degree",
      repo: "quack-ops",
    });

    expect(result).toEqual({
      ok: true,
      installationId: 900,
      repositoryId: 555,
      defaultBranch: "main",
    });
  });

  test("every member resolves the same installation", async () => {
    const first = await verifyRepoAccess({
      userId: "u1",
      owner: "next-degree",
      repo: "quack-ops",
    });
    const second = await verifyRepoAccess({
      userId: "u2",
      owner: "next-degree",
      repo: "quack-ops",
    });

    expect(first.ok && first.installationId).toBe(900);
    expect(second.ok && second.installationId).toBe(900);
  });

  test("the organization's installation wins over a personal record", async () => {
    state.personalInstallation = { installationId: 111 };

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "next-degree",
      repo: "quack-ops",
    });

    expect(result.ok && result.installationId).toBe(900);
  });

  test("falls back to a personal record while the account is unclaimed", async () => {
    state.orgInstallation = undefined;
    state.personalInstallation = { installationId: 111 };

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "next-degree",
      repo: "quack-ops",
    });

    expect(result.ok && result.installationId).toBe(111);
  });

  test("denies when neither an organization nor a personal record exists", async () => {
    state.orgInstallation = undefined;
    state.personalInstallation = undefined;

    const result = await verifyRepoAccess({
      userId: "u1",
      owner: "next-degree",
      repo: "quack-ops",
    });

    expect(result).toEqual({ ok: false, reason: "no_installation" });
  });
});
