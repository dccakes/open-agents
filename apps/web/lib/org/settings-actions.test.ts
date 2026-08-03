import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AuthorizationError } from "@/lib/auth/authorization-error";
import { orgSettings, organizations } from "@/lib/db/schema";

/**
 * Drives the real settings module against a fake database rather than mocking
 * `@/lib/org/settings`: a module mock would leak into every test file loaded
 * afterwards, and the point of these cases is that the action layer forwards a
 * denial rather than swallowing it.
 */

let approved = true;
let permittedToUpdate = true;
let updateCalls: Record<string, unknown>[] = [];
let settingsRow: Record<string, unknown> = {
  organizationId: "org-1",
  agentRunsPaused: false,
  dailyTokenBudget: null,
};

function rowsFor(table: unknown): Promise<Record<string, unknown>[]> {
  if (table === organizations) {
    return Promise.resolve([{ id: "org-1" }]);
  }
  if (table === orgSettings) {
    return Promise.resolve([settingsRow]);
  }
  return Promise.resolve([]);
}

function selectChain(table: unknown) {
  return {
    where: () => selectChain(table),
    limit: () => rowsFor(table),
  };
}

const transactionClient = {
  select: () => ({ from: (table: unknown) => selectChain(table) }),
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          updateCalls.push(values);
          settingsRow = { ...settingsRow, ...values };
          return Promise.resolve([settingsRow]);
        },
      }),
    }),
  }),
};

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => ({ from: (table: unknown) => selectChain(table) }),
    transaction: <T>(callback: (tx: unknown) => Promise<T>) =>
      callback(transactionClient),
  },
}));

mock.module("@/lib/auth/require-permission", () => ({
  requireApprovedMember: () => {
    if (!approved) {
      return Promise.reject(
        new AuthorizationError("forbidden", "Membership is pending approval"),
      );
    }
    return Promise.resolve({
      userId: "user-1",
      organizationId: "org-1",
      role: permittedToUpdate ? "admin" : "member",
    });
  },
  requirePermission: () => {
    if (!permittedToUpdate) {
      return Promise.reject(new AuthorizationError("forbidden"));
    }
    return Promise.resolve();
  },
  hasPermission: () => Promise.resolve(permittedToUpdate),
}));

const modulePromise = import("@/lib/org/settings-actions");

beforeEach(() => {
  approved = true;
  permittedToUpdate = true;
  updateCalls = [];
  settingsRow = {
    organizationId: "org-1",
    agentRunsPaused: false,
    dailyTokenBudget: null,
  };
});

describe("loadOrgSettings", () => {
  test("returns the current values to an approved member", async () => {
    permittedToUpdate = false;
    const { loadOrgSettings } = await modulePromise;

    const result = await loadOrgSettings();

    expect(result).toEqual({
      success: true,
      settings: {
        agentRunsPaused: false,
        dailyTokenBudget: null,
        // A plain member reads the settings but cannot change them.
        canUpdate: false,
      },
    });
  });

  test("refuses a pending user", async () => {
    approved = false;
    const { loadOrgSettings } = await modulePromise;

    const result = await loadOrgSettings();

    expect(result).toMatchObject({ success: false, status: 403 });
  });
});

describe("saveOrgSettings", () => {
  test("answers 403 and writes nothing for a member without orgSettings.update", async () => {
    permittedToUpdate = false;
    const { saveOrgSettings } = await modulePromise;

    const result = await saveOrgSettings({ agentRunsPaused: true });

    expect(result).toMatchObject({ success: false, status: 403 });
    expect(updateCalls).toEqual([]);
    expect(settingsRow.agentRunsPaused).toBe(false);
  });

  test("answers 400 for a malformed budget", async () => {
    const { saveOrgSettings } = await modulePromise;

    const result = await saveOrgSettings({ dailyTokenBudget: -1 });

    expect(result).toMatchObject({ success: false, status: 400 });
    expect(updateCalls).toEqual([]);
  });

  test("persists the change for a caller who may update", async () => {
    const { saveOrgSettings } = await modulePromise;

    const result = await saveOrgSettings({
      agentRunsPaused: true,
      dailyTokenBudget: 250_000,
    });

    expect(result).toEqual({
      success: true,
      settings: {
        agentRunsPaused: true,
        dailyTokenBudget: 250_000,
        canUpdate: true,
      },
    });
    expect(updateCalls).toHaveLength(1);
  });
});
