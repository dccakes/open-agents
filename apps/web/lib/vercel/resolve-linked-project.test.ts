import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { VercelProjectSelection } from "@/lib/vercel/types";

let link: VercelProjectSelection | null = null;
let token: string | null = "vercel-token";
let visibleProjects: { projectId: string }[] = [];
let listThrows = false;

mock.module("@/lib/db/vercel-project-links", () => ({
  getVercelProjectLinkByRepo: async () => link,
}));

mock.module("@/lib/vercel/token", () => ({
  getUserVercelToken: async () => token,
}));

mock.module("@/lib/vercel/projects", () => ({
  listMatchingVercelProjects: async () => {
    if (listThrows) {
      throw new Error("token revoked");
    }
    return visibleProjects;
  },
}));

mock.module("server-only", () => ({}));

const modulePromise = import("@/lib/vercel/resolve-linked-project");

const REPO = { userId: "u1", repoOwner: "next-degree", repoName: "quack-ops" };

beforeEach(() => {
  link = {
    projectId: "prj_a",
    projectName: "web",
    teamId: "team_1",
    teamSlug: "next-degree",
  };
  token = "vercel-token";
  visibleProjects = [{ projectId: "prj_a" }];
  listThrows = false;
});

describe("resolveUsableVercelProjectLink", () => {
  test("returns the organization's link when the member can see the project", async () => {
    const { resolveUsableVercelProjectLink } = await modulePromise;

    expect(await resolveUsableVercelProjectLink(REPO)).toEqual({
      projectId: "prj_a",
      projectName: "web",
      teamId: "team_1",
      teamSlug: "next-degree",
    });
  });

  // The point of the whole helper: the organization owns the mapping, but the
  // token that has to query the project is personal. A member who cannot see
  // the project must not get a session pointing at it.
  test("returns nothing when the member cannot see the linked project", async () => {
    visibleProjects = [{ projectId: "prj_someone_elses" }];
    const { resolveUsableVercelProjectLink } = await modulePromise;

    expect(await resolveUsableVercelProjectLink(REPO)).toBeNull();
  });

  test("returns nothing when the member has not connected Vercel", async () => {
    token = null;
    const { resolveUsableVercelProjectLink } = await modulePromise;

    expect(await resolveUsableVercelProjectLink(REPO)).toBeNull();
  });

  test("returns nothing when the repository has no organization link", async () => {
    link = null;
    const { resolveUsableVercelProjectLink } = await modulePromise;

    expect(await resolveUsableVercelProjectLink(REPO)).toBeNull();
  });

  // Session creation must not fail because a Vercel token lapsed on a path
  // where nobody asked for a Vercel project.
  test("degrades to nothing when the Vercel call fails", async () => {
    listThrows = true;
    const { resolveUsableVercelProjectLink } = await modulePromise;

    expect(await resolveUsableVercelProjectLink(REPO)).toBeNull();
  });
});
