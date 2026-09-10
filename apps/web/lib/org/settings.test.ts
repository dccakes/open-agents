import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import { OrgSettingsError } from "@/lib/org/settings-errors";
import type { OrgSettingsAuditEntry } from "@/lib/org/settings-audit";

interface SettingsRow {
  organizationId: string;
  agentRunsPaused: boolean;
  dailyTokenBudget: number | null;
  // Stored on this row but gated elsewhere — see `lib/org/vercel-team.ts`.
  vercelTeamId: string | null;
  vercelTeamSlug: string | null;
}

/** The Vercel columns' resting state, spread into each fixture row. */
const NO_VERCEL_TEAM = {
  vercelTeamId: null,
  vercelTeamSlug: null,
} as const;

let settingsRow: SettingsRow | null = null;
let organizationId: string | null = "org-1";
let selectError: Error | null = null;
let permitted = true;
let updateCalls: Record<string, unknown>[] = [];
let auditCalls: { transaction: unknown; entry: OrgSettingsAuditEntry }[] = [];
let transactionDepth = 0;
let auditDepthAtCall: number[] = [];
let openedTransactions = 0;

async function readRow(): Promise<SettingsRow[]> {
  if (selectError) {
    throw selectError;
  }
  return settingsRow ? [settingsRow] : [];
}

const selectBuilder = {
  from: () => ({
    where: () => ({
      limit: () => readRow(),
    }),
  }),
};

const transactionClient = {
  select: () => selectBuilder,
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          updateCalls.push(values);
          if (!settingsRow) {
            return Promise.resolve([]);
          }
          settingsRow = { ...settingsRow, ...values } as SettingsRow;
          return Promise.resolve([settingsRow]);
        },
      }),
    }),
  }),
};

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => selectBuilder,
    transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      openedTransactions += 1;
      transactionDepth += 1;
      try {
        return await callback(transactionClient);
      } finally {
        transactionDepth -= 1;
      }
    },
  },
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: () => Promise.resolve(organizationId),
  requireSeededOrganizationId: () => {
    if (!organizationId) {
      return Promise.reject(
        new OrgSettingsError("unavailable", "not seeded yet"),
      );
    }
    return Promise.resolve(organizationId);
  },
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

mock.module("@/lib/org/settings-audit", () => ({
  recordOrgSettingsAudit: (
    transaction: unknown,
    entry: OrgSettingsAuditEntry,
  ) => {
    auditCalls.push({ transaction, entry });
    auditDepthAtCall.push(transactionDepth);
    return Promise.resolve();
  },
}));

const modulePromise = import("@/lib/org/settings");

beforeEach(() => {
  settingsRow = {
    organizationId: "org-1",
    agentRunsPaused: false,
    dailyTokenBudget: null,
    ...NO_VERCEL_TEAM,
  };
  organizationId = "org-1";
  selectError = null;
  permitted = true;
  updateCalls = [];
  auditCalls = [];
  auditDepthAtCall = [];
  openedTransactions = 0;
  transactionDepth = 0;
});

describe("readOrgSettings", () => {
  test("returns the kill-switch state and the daily token budget", async () => {
    settingsRow = {
      organizationId: "org-1",
      agentRunsPaused: true,
      dailyTokenBudget: 500_000,
      ...NO_VERCEL_TEAM,
    };
    const { readOrgSettings } = await modulePromise;

    await expect(readOrgSettings()).resolves.toEqual({
      organizationId: "org-1",
      agentRunsPaused: true,
      dailyTokenBudget: 500_000,
      ...NO_VERCEL_TEAM,
    });
  });

  test("raises an unavailable error when the settings row is missing", async () => {
    settingsRow = null;
    const { readOrgSettings } = await modulePromise;

    expect(readOrgSettings()).rejects.toMatchObject({
      name: "OrgSettingsError",
      kind: "unavailable",
    });
  });

  test("raises an unavailable error when the organization is not seeded", async () => {
    organizationId = null;
    const { readOrgSettings } = await modulePromise;

    expect(readOrgSettings()).rejects.toMatchObject({
      name: "OrgSettingsError",
      kind: "unavailable",
    });
  });

  test("propagates a read failure rather than substituting a default", async () => {
    selectError = new Error("connection reset");
    const { readOrgSettings } = await modulePromise;

    expect(readOrgSettings()).rejects.toThrow("connection reset");
  });
});

describe("getDailyTokenBudget", () => {
  test("reports an explicit unlimited when the column is null", async () => {
    const { getDailyTokenBudget } = await modulePromise;

    await expect(getDailyTokenBudget()).resolves.toEqual({
      limit: "unlimited",
    });
  });

  test("reports the configured integer when the column is set", async () => {
    settingsRow = {
      organizationId: "org-1",
      agentRunsPaused: false,
      dailyTokenBudget: 1_000_000,
      ...NO_VERCEL_TEAM,
    };
    const { getDailyTokenBudget } = await modulePromise;

    await expect(getDailyTokenBudget()).resolves.toEqual({
      limit: "limited",
      dailyTokens: 1_000_000,
    });
  });
});

describe("updateOrgSettings", () => {
  test("refuses a caller without orgSettings.update and modifies no column", async () => {
    permitted = false;
    const { updateOrgSettings } = await modulePromise;

    await expect(
      updateOrgSettings({ agentRunsPaused: true }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(updateCalls).toEqual([]);
    expect(auditCalls).toEqual([]);
    expect(settingsRow?.agentRunsPaused).toBe(false);
  });

  test("persists the change for a caller holding orgSettings.update", async () => {
    const { updateOrgSettings } = await modulePromise;

    const result = await updateOrgSettings({
      agentRunsPaused: true,
      dailyTokenBudget: 250_000,
    });

    expect(result).toMatchObject({
      agentRunsPaused: true,
      dailyTokenBudget: 250_000,
    });
    expect(updateCalls[0]).toMatchObject({
      agentRunsPaused: true,
      dailyTokenBudget: 250_000,
    });
  });

  test("writes the audit record inside the same transaction as the mutation", async () => {
    const { updateOrgSettings } = await modulePromise;

    await updateOrgSettings({ dailyTokenBudget: 250_000 });

    expect(openedTransactions).toBe(1);
    expect(auditCalls).toHaveLength(1);
    // Called with the transaction handle, and while that transaction is open,
    // so the audit write cannot land without the mutation.
    expect(auditCalls[0]?.transaction).toBe(transactionClient);
    expect(auditDepthAtCall).toEqual([1]);
  });

  test("records the actor and the previous and new values", async () => {
    const { updateOrgSettings } = await modulePromise;

    await updateOrgSettings({ agentRunsPaused: true });

    const entry = auditCalls[0]?.entry;
    expect(entry?.actorId).toBe("user-admin");
    expect(entry?.organizationId).toBe("org-1");
    expect(entry?.occurredAt).toBeInstanceOf(Date);
    expect(entry?.changes).toEqual([
      { field: "agentRunsPaused", previousValue: false, newValue: true },
    ]);
  });

  test("records only the fields that actually changed", async () => {
    settingsRow = {
      organizationId: "org-1",
      agentRunsPaused: true,
      dailyTokenBudget: null,
      ...NO_VERCEL_TEAM,
    };
    const { updateOrgSettings } = await modulePromise;

    await updateOrgSettings({
      agentRunsPaused: true,
      dailyTokenBudget: 100,
    });

    expect(auditCalls[0]?.entry.changes).toEqual([
      { field: "dailyTokenBudget", previousValue: null, newValue: 100 },
    ]);
  });

  test("rejects a malformed budget without writing", async () => {
    const { updateOrgSettings } = await modulePromise;

    await expect(
      updateOrgSettings({ dailyTokenBudget: -5 }),
    ).rejects.toMatchObject({ kind: "invalid" });
    await expect(
      updateOrgSettings({ dailyTokenBudget: "lots" }),
    ).rejects.toMatchObject({ kind: "invalid" });
    expect(updateCalls).toEqual([]);
  });

  test("rejects an update naming no field", async () => {
    const { updateOrgSettings } = await modulePromise;

    await expect(updateOrgSettings({})).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(updateCalls).toEqual([]);
  });

  test("accepts clearing the budget back to unlimited", async () => {
    settingsRow = {
      organizationId: "org-1",
      agentRunsPaused: false,
      dailyTokenBudget: 100,
      ...NO_VERCEL_TEAM,
    };
    const { updateOrgSettings } = await modulePromise;

    const result = await updateOrgSettings({ dailyTokenBudget: null });

    expect(result.dailyTokenBudget).toBeNull();
  });
});
