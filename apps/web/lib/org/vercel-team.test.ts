import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import { OrgSettingsError } from "@/lib/org/settings-errors";

let permitted = true;
let settings: {
  organizationId: string;
  agentRunsPaused: boolean;
  dailyTokenBudget: number | null;
  vercelTeamId: string | null;
  vercelTeamSlug: string | null;
} | null = {
  organizationId: "org-1",
  agentRunsPaused: false,
  dailyTokenBudget: null,
  vercelTeamId: null,
  vercelTeamSlug: null,
};

let writes: { fields: Record<string, unknown>; actorId: string }[] = [];

// Mocked at the `lib/org/settings` seam rather than at the database, because
// that is where this module's contract now lives: it contributes the gate and
// the field mapping, and delegates the transaction and audit record.
mock.module("@/lib/org/settings", () => ({
  readOrgSettings: async () => {
    if (!settings) {
      throw new OrgSettingsError("unavailable", "no settings row");
    }
    return settings;
  },
  writeOrgSettingsFields: async (
    fields: Record<string, unknown>,
    actorId: string,
  ) => {
    writes.push({ fields, actorId });
    if (!settings) {
      throw new OrgSettingsError("unavailable", "no settings row");
    }
    settings = { ...settings, ...fields } as typeof settings;
    return settings;
  },
}));

mock.module("@/lib/auth/require-permission", () => ({
  requireApprovedMember: () =>
    Promise.resolve({
      userId: "user-admin",
      organizationId: "org-1",
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
  writes = [];
  settings = {
    organizationId: "org-1",
    agentRunsPaused: false,
    dailyTokenBudget: null,
    vercelTeamId: null,
    vercelTeamSlug: null,
  };
});

describe("setOrgVercelTeam", () => {
  test("refuses a caller without integration.connect and changes nothing", async () => {
    permitted = false;
    const { setOrgVercelTeam } = await modulePromise;

    await expect(
      setOrgVercelTeam({ teamId: "team_1", teamSlug: "next-degree" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(writes).toEqual([]);
    expect(settings?.vercelTeamId).toBeNull();
  });

  test("records the team for a permitted caller", async () => {
    const { setOrgVercelTeam } = await modulePromise;

    const result = await setOrgVercelTeam({
      teamId: "team_1",
      teamSlug: "next-degree",
    });

    expect(result).toEqual({ teamId: "team_1", teamSlug: "next-degree" });
  });

  // The write goes through the settings module's transaction so it lands in
  // the same audit record as every other `org_settings` change — an earlier
  // draft wrote the columns directly and silently sat outside that trail.
  test("writes through the audited settings path, attributed to the actor", async () => {
    const { setOrgVercelTeam } = await modulePromise;

    await setOrgVercelTeam({ teamId: "team_1", teamSlug: "next-degree" });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.actorId).toBe("user-admin");
    expect(writes[0]?.fields).toEqual({
      vercelTeamId: "team_1",
      vercelTeamSlug: "next-degree",
    });
  });

  test("rejects malformed input before writing", async () => {
    const { setOrgVercelTeam } = await modulePromise;

    await expect(setOrgVercelTeam({ teamId: 7 })).rejects.toMatchObject({
      name: "OrgSettingsError",
      kind: "invalid",
    });
    expect(writes).toEqual([]);
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
    settings = {
      organizationId: "org-1",
      agentRunsPaused: false,
      dailyTokenBudget: null,
      vercelTeamId: "team_1",
      vercelTeamSlug: "next-degree",
    };
    const { readOrgVercelTeam } = await modulePromise;

    await expect(readOrgVercelTeam()).resolves.toEqual({
      teamId: "team_1",
      teamSlug: "next-degree",
    });
  });

  test("raises when the settings row is missing", async () => {
    settings = null;
    const { readOrgVercelTeam } = await modulePromise;

    await expect(readOrgVercelTeam()).rejects.toMatchObject({
      name: "OrgSettingsError",
      kind: "unavailable",
    });
  });
});
