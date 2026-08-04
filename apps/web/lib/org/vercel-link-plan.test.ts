import { describe, expect, test } from "bun:test";
import {
  conflictedRepos,
  planVercelLinkMigration,
  type VercelLinkRecord,
} from "@/lib/org/vercel-link-plan";

function link(overrides: Partial<VercelLinkRecord> = {}): VercelLinkRecord {
  return {
    userId: "u1",
    organizationId: null,
    repoOwner: "next-degree",
    repoName: "quack-ops",
    projectId: "prj_a",
    projectName: "quack-ops-web",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("planVercelLinkMigration", () => {
  test("promotes a repository every member agrees on", () => {
    const plan = planVercelLinkMigration([
      link({ userId: "u2", createdAt: new Date("2026-02-01T00:00:00Z") }),
      link({ userId: "u1", createdAt: new Date("2026-01-01T00:00:00Z") }),
    ]);

    expect(plan).toHaveLength(1);
    const entry = plan[0];
    expect(entry?.kind).toBe("promote");
    if (entry?.kind !== "promote") return;
    expect(entry.keepUserId).toBe("u1");
    expect(entry.deleteUserIds).toEqual(["u2"]);
    expect(entry.projectId).toBe("prj_a");
    expect(entry.needsOwnershipWrite).toBe(true);
  });

  test("refuses to promote a repository members disagree on", () => {
    const plan = planVercelLinkMigration([
      link({ userId: "u1", projectId: "prj_a", projectName: "web" }),
      link({ userId: "u2", projectId: "prj_b", projectName: "web-staging" }),
    ]);

    expect(plan).toHaveLength(1);
    const entry = plan[0];
    expect(entry?.kind).toBe("conflict");
    if (entry?.kind !== "conflict") return;
    expect(entry.candidates).toHaveLength(2);
    expect(entry.candidates.map((c) => c.projectId).sort()).toEqual([
      "prj_a",
      "prj_b",
    ]);
  });

  test("picks no winner at all when members disagree", () => {
    const plan = planVercelLinkMigration([
      link({
        userId: "u1",
        projectId: "prj_a",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
      link({
        userId: "u2",
        projectId: "prj_b",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      }),
    ]);

    // Neither "earliest wins" nor "most recent wins" leaks in as a tiebreak.
    expect(plan.some((entry) => entry.kind === "promote")).toBe(false);
  });

  test("handles agreeing and disagreeing repositories independently", () => {
    const plan = planVercelLinkMigration([
      link({ repoName: "agreed", userId: "u1", projectId: "prj_a" }),
      link({ repoName: "agreed", userId: "u2", projectId: "prj_a" }),
      link({ repoName: "disputed", userId: "u1", projectId: "prj_a" }),
      link({ repoName: "disputed", userId: "u2", projectId: "prj_b" }),
    ]);

    expect(plan.map((entry) => entry.repoName)).toEqual(["agreed", "disputed"]);
    expect(plan[0]?.kind).toBe("promote");
    expect(plan[1]?.kind).toBe("conflict");
  });

  test("distinguishes repositories with the same name under different owners", () => {
    const plan = planVercelLinkMigration([
      link({ repoOwner: "next-degree", projectId: "prj_a" }),
      link({ repoOwner: "someone-else", projectId: "prj_b" }),
    ]);

    expect(plan).toHaveLength(2);
    expect(plan.every((entry) => entry.kind === "promote")).toBe(true);
  });

  test("re-running against an already-promoted repository changes nothing", () => {
    const plan = planVercelLinkMigration([
      link({ userId: "u1", organizationId: "org-1" }),
    ]);

    const entry = plan[0];
    expect(entry?.kind).toBe("promote");
    if (entry?.kind !== "promote") return;
    expect(entry.needsOwnershipWrite).toBe(false);
    expect(entry.deleteUserIds).toEqual([]);
  });

  test("an already-owned row survives even when a personal row is older", () => {
    const plan = planVercelLinkMigration([
      link({ userId: "old", createdAt: new Date("2025-01-01T00:00:00Z") }),
      link({
        userId: "owned",
        organizationId: "org-1",
        createdAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ]);

    const entry = plan[0];
    if (entry?.kind !== "promote") throw new Error("expected a promotion");
    expect(entry.keepUserId).toBe("owned");
    expect(entry.deleteUserIds).toEqual(["old"]);
  });

  test("breaks timestamp ties deterministically on user id", () => {
    const sameInstant = new Date("2026-01-01T00:00:00Z");
    const forward = planVercelLinkMigration([
      link({ userId: "b", createdAt: sameInstant }),
      link({ userId: "a", createdAt: sameInstant }),
    ]);
    const reversed = planVercelLinkMigration([
      link({ userId: "a", createdAt: sameInstant }),
      link({ userId: "b", createdAt: sameInstant }),
    ]);

    expect(forward[0]?.kind === "promote" && forward[0].keepUserId).toBe("a");
    expect(reversed[0]?.kind === "promote" && reversed[0].keepUserId).toBe("a");
  });

  test("plans nothing when there are no links", () => {
    expect(planVercelLinkMigration([])).toEqual([]);
  });
});

describe("conflictedRepos", () => {
  test("returns only the repositories that could not be migrated", () => {
    const plan = planVercelLinkMigration([
      link({ repoName: "agreed", userId: "u1" }),
      link({ repoName: "disputed", userId: "u1", projectId: "prj_a" }),
      link({ repoName: "disputed", userId: "u2", projectId: "prj_b" }),
    ]);

    const conflicts = conflictedRepos(plan);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.repoName).toBe("disputed");
  });
});
