import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";

let permitted = true;
let organizationId: string | null = "org-1";
let teamRow: { teamId: string | null; teamSlug: string | null } | null = {
  teamId: null,
  teamSlug: null,
};

let updateCalls: Record<string, unknown>[] = [];

const selectBuilder = {
  from: () => ({
    where: () => ({
      limit: () => Promise.resolve(teamRow ? [teamRow] : []),
    }),
  }),
};

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => selectBuilder,
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updateCalls.push(values);
            if (!teamRow) {
              return Promise.resolve([]);
            }
            teamRow = {
              teamId: values.vercelTeamId as string | null,
              teamSlug: values.vercelTeamSlug as string | null,
            };
            return Promise.resolve([teamRow]);
          },
        }),
      }),
    }),
  },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => organizationId,
}));

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

const modulePromise = import("@/lib/org/vercel-team");

beforeEach(() => {
  permitted = true;
  organizationId = "org-1";
  teamRow = { teamId: null, teamSlug: null };
  updateCalls = [];
});

describe("setOrgVercelTeam", () => {
  test("refuses a caller without integration.connect and changes nothing", async () => {
    permitted = false;
    const { setOrgVercelTeam } = await modulePromise;

    await expect(
      setOrgVercelTeam({ teamId: "team_1", teamSlug: "next-degree" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(updateCalls).toEqual([]);
    expect(teamRow?.teamId).toBeNull();
  });

  test("records the team for a permitted caller", async () => {
    const { setOrgVercelTeam } = await modulePromise;

    const result = await setOrgVercelTeam({
      teamId: "team_1",
      teamSlug: "next-degree",
    });

    expect(result).toEqual({ teamId: "team_1", teamSlug: "next-degree" });
  });

  test("rejects malformed input", async () => {
    const { setOrgVercelTeam } = await modulePromise;

    await expect(setOrgVercelTeam({ teamId: 7 })).rejects.toMatchObject({
      name: "OrgSettingsError",
      kind: "invalid",
    });
    expect(updateCalls).toEqual([]);
  });

  test("allows clearing the team", async () => {
    const { setOrgVercelTeam } = await modulePromise;

    await expect(
      setOrgVercelTeam({ teamId: null, teamSlug: null }),
    ).resolves.toEqual({ teamId: null, teamSlug: null });
  });
});

describe("readOrgVercelTeam", () => {
  test("is open to an approved member without integration.connect", async () => {
    permitted = false;
    teamRow = { teamId: "team_1", teamSlug: "next-degree" };
    const { readOrgVercelTeam } = await modulePromise;

    await expect(readOrgVercelTeam()).resolves.toEqual({
      teamId: "team_1",
      teamSlug: "next-degree",
    });
  });

  test("raises when the settings row is missing", async () => {
    teamRow = null;
    const { readOrgVercelTeam } = await modulePromise;

    await expect(readOrgVercelTeam()).rejects.toMatchObject({
      name: "OrgSettingsError",
      kind: "unavailable",
    });
  });
});
