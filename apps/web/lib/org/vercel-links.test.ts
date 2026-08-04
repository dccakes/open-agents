import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import type { VercelLinkRecord } from "@/lib/org/vercel-link-plan";

let permitted = true;
let organizationId: string | null = "org-1";
let allLinks: VercelLinkRecord[] = [];
let personalForRepo: VercelLinkRecord[] = [];
let unresolvedConflicts: {
  repoOwner: string;
  repoName: string;
  detectedAt: Date;
}[] = [];

const claimedLinks: Record<string, unknown>[] = [];
const deletedLinks: Record<string, unknown>[] = [];
const recordedConflicts: Record<string, unknown>[] = [];
const resolvedConflicts: Record<string, unknown>[] = [];

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
}));

mock.module("@/lib/db/vercel-project-links", () => ({
  getAllVercelProjectLinks: async () => allLinks,
  getPersonalVercelLinksForRepo: async () => personalForRepo,
  claimVercelLinkForOrganization: async (p: Record<string, unknown>) => {
    claimedLinks.push(p);
  },
  deleteVercelLinksForUsers: async (p: {
    userIds: string[];
    repoOwner: string;
    repoName: string;
  }) => {
    deletedLinks.push(p);
    return p.userIds.length;
  },
}));

mock.module("@/lib/db/vercel-link-conflicts", () => ({
  listUnresolvedVercelLinkConflicts: async () => unresolvedConflicts,
  recordVercelLinkConflict: async (p: Record<string, unknown>) => {
    recordedConflicts.push(p);
  },
  resolveVercelLinkConflict: async (p: Record<string, unknown>) => {
    resolvedConflicts.push(p);
  },
  hasUnresolvedVercelLinkConflicts: async () => unresolvedConflicts.length > 0,
}));

const modulePromise = import("@/lib/org/vercel-links");

function link(overrides: Partial<VercelLinkRecord> = {}): VercelLinkRecord {
  return {
    userId: "u1",
    organizationId: null,
    repoOwner: "next-degree",
    repoName: "quack-ops",
    projectId: "prj_a",
    projectName: "web",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  permitted = true;
  organizationId = "org-1";
  allLinks = [];
  personalForRepo = [];
  unresolvedConflicts = [];
  claimedLinks.length = 0;
  deletedLinks.length = 0;
  recordedConflicts.length = 0;
  resolvedConflicts.length = 0;
});

describe("migrateVercelLinksToOrganization", () => {
  test("migrates a repository every member agrees on", async () => {
    allLinks = [
      link({ userId: "u1" }),
      link({ userId: "u2", createdAt: new Date("2026-02-01") }),
    ];
    const { migrateVercelLinksToOrganization } = await modulePromise;

    const outcome = await migrateVercelLinksToOrganization();

    expect(outcome.promotedRepoCount).toBe(1);
    expect(claimedLinks[0]).toMatchObject({ userId: "u1" });
    expect(deletedLinks[0]).toMatchObject({ userIds: ["u2"] });
    expect(recordedConflicts).toEqual([]);
  });

  test("migrates nothing for a repository members disagree on", async () => {
    allLinks = [
      link({ userId: "u1", projectId: "prj_a" }),
      link({ userId: "u2", projectId: "prj_b" }),
    ];
    const { migrateVercelLinksToOrganization } = await modulePromise;

    const outcome = await migrateVercelLinksToOrganization();

    expect(outcome.conflictedRepoCount).toBe(1);
    expect(outcome.promotedRepoCount).toBe(0);
    // Crucially: no winner picked, and the per-user rows are left alone.
    expect(claimedLinks).toEqual([]);
    expect(deletedLinks).toEqual([]);
    expect(recordedConflicts[0]).toMatchObject({ repoName: "quack-ops" });
  });

  test("handles agreeing and disagreeing repositories in one pass", async () => {
    allLinks = [
      link({ repoName: "agreed", userId: "u1" }),
      link({ repoName: "agreed", userId: "u2" }),
      link({ repoName: "disputed", userId: "u1", projectId: "prj_a" }),
      link({ repoName: "disputed", userId: "u2", projectId: "prj_b" }),
    ];
    const { migrateVercelLinksToOrganization } = await modulePromise;

    const outcome = await migrateVercelLinksToOrganization();

    expect(outcome.promotedRepoCount).toBe(1);
    expect(outcome.conflictedRepoCount).toBe(1);
  });

  test("is a no-op when re-run against already-migrated links", async () => {
    allLinks = [link({ userId: "u1", organizationId: "org-1" })];
    const { migrateVercelLinksToOrganization } = await modulePromise;

    const outcome = await migrateVercelLinksToOrganization();

    expect(outcome.promotedRepoCount).toBe(0);
    expect(claimedLinks).toEqual([]);
  });
});

describe("resolveVercelLinkDisagreement", () => {
  test("refuses a caller without integration.connect", async () => {
    permitted = false;
    const { resolveVercelLinkDisagreement } = await modulePromise;

    await expect(
      resolveVercelLinkDisagreement({
        repoOwner: "next-degree",
        repoName: "quack-ops",
        projectId: "prj_a",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(claimedLinks).toEqual([]);
    expect(resolvedConflicts).toEqual([]);
  });

  test("promotes the chosen project and clears the conflict", async () => {
    personalForRepo = [
      link({ userId: "u1", projectId: "prj_a" }),
      link({ userId: "u2", projectId: "prj_b" }),
    ];
    const { resolveVercelLinkDisagreement } = await modulePromise;

    await resolveVercelLinkDisagreement({
      repoOwner: "next-degree",
      repoName: "quack-ops",
      projectId: "prj_b",
    });

    expect(claimedLinks[0]).toMatchObject({ userId: "u2" });
    expect(deletedLinks[0]).toMatchObject({ userIds: ["u1"] });
    expect(resolvedConflicts).toHaveLength(1);
  });

  test("refuses a project no member actually recorded", async () => {
    personalForRepo = [link({ userId: "u1", projectId: "prj_a" })];
    const { resolveVercelLinkDisagreement } = await modulePromise;

    await expect(
      resolveVercelLinkDisagreement({
        repoOwner: "next-degree",
        repoName: "quack-ops",
        projectId: "prj_invented",
      }),
    ).rejects.toMatchObject({ name: "OrgSettingsError", kind: "invalid" });
    expect(claimedLinks).toEqual([]);
  });
});

describe("readVercelLinkConflicts", () => {
  test("groups the competing projects with who recorded each", async () => {
    unresolvedConflicts = [
      {
        repoOwner: "next-degree",
        repoName: "quack-ops",
        detectedAt: new Date("2026-08-01"),
      },
    ];
    personalForRepo = [
      link({ userId: "u1", projectId: "prj_a", projectName: "web" }),
      link({ userId: "u2", projectId: "prj_b", projectName: "staging" }),
      link({ userId: "u3", projectId: "prj_a", projectName: "web" }),
    ];
    const { readVercelLinkConflicts } = await modulePromise;

    const [view] = await readVercelLinkConflicts();

    expect(view?.candidates).toHaveLength(2);
    expect(
      view?.candidates.find((c) => c.projectId === "prj_a")?.userIds,
    ).toEqual(["u1", "u3"]);
  });
});

describe("vercelLinkContractReady", () => {
  test("blocks while a disagreement is unresolved", async () => {
    unresolvedConflicts = [
      {
        repoOwner: "next-degree",
        repoName: "quack-ops",
        detectedAt: new Date(),
      },
    ];
    const { vercelLinkContractReady } = await modulePromise;

    expect(await vercelLinkContractReady()).toBe(false);
  });

  test("allows once every disagreement is resolved", async () => {
    const { vercelLinkContractReady } = await modulePromise;

    expect(await vercelLinkContractReady()).toBe(true);
  });
});
