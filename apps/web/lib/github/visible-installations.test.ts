import { beforeEach, describe, expect, mock, test } from "bun:test";

interface Row {
  id: string;
  installationId: number;
  accountLogin: string;
  organizationId: string | null;
}

let personal: Row[] = [];
let organizational: Row[] = [];
let organizationId: string | null = "org-1";

mock.module("@/lib/db/installations", () => ({
  getInstallationsByUserId: async () => personal,
  getOrgInstallations: async () => organizational,
}));

mock.module("@/lib/org/seeded-organization", () => ({
  getSeededOrganizationId: async () => organizationId,
}));

const modulePromise = import("@/lib/github/visible-installations");

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "r1",
    installationId: 100,
    accountLogin: "next-degree",
    organizationId: null,
    ...overrides,
  };
}

beforeEach(() => {
  personal = [];
  organizational = [];
  organizationId = "org-1";
});

describe("getVisibleInstallations", () => {
  test("shows the organization's installations to a member with none of their own", async () => {
    organizational = [
      row({ id: "org-row", organizationId: "org-1", installationId: 900 }),
    ];
    const { getVisibleInstallations } = await modulePromise;

    const visible = await getVisibleInstallations("member-who-never-synced");

    expect(visible.map((i) => i.installationId)).toEqual([900]);
  });

  test("shows a member their own installations alongside the organization's", async () => {
    personal = [
      row({ id: "mine", installationId: 100, accountLogin: "my-account" }),
    ];
    organizational = [
      row({
        id: "ours",
        installationId: 900,
        accountLogin: "next-degree",
        organizationId: "org-1",
      }),
    ];
    const { getVisibleInstallations } = await modulePromise;

    const visible = await getVisibleInstallations("u1");

    expect(visible.map((i) => i.installationId).sort()).toEqual([100, 900]);
  });

  test("prefers the organization's record over a stale personal duplicate", async () => {
    personal = [row({ id: "stale", installationId: 900 })];
    organizational = [
      row({ id: "ours", installationId: 900, organizationId: "org-1" }),
    ];
    const { getVisibleInstallations } = await modulePromise;

    const visible = await getVisibleInstallations("u1");

    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe("ours");
  });

  test("orders by account login", async () => {
    organizational = [
      row({ id: "b", installationId: 2, accountLogin: "zebra" }),
      row({ id: "a", installationId: 1, accountLogin: "alpha" }),
    ];
    const { getVisibleInstallations } = await modulePromise;

    const visible = await getVisibleInstallations("u1");

    expect(visible.map((i) => i.accountLogin)).toEqual(["alpha", "zebra"]);
  });

  test("falls back to personal records when the organization is not seeded", async () => {
    organizationId = null;
    personal = [row({ id: "mine" })];
    const { getVisibleInstallations } = await modulePromise;

    const visible = await getVisibleInstallations("u1");

    expect(visible.map((i) => i.id)).toEqual(["mine"]);
  });

  test("shows nothing when there is nothing to show", async () => {
    const { getVisibleInstallations } = await modulePromise;

    expect(await getVisibleInstallations("u1")).toEqual([]);
  });
});

describe("getVisibleInstallationById", () => {
  test("finds an organization-owned installation for a member who never synced", async () => {
    organizational = [
      row({ id: "ours", installationId: 900, organizationId: "org-1" }),
    ];
    const { getVisibleInstallationById } = await modulePromise;

    expect(
      (await getVisibleInstallationById("member-who-never-synced", 900))?.id,
    ).toBe("ours");
  });

  test("returns nothing for an installation the member cannot see", async () => {
    const { getVisibleInstallationById } = await modulePromise;

    expect(await getVisibleInstallationById("u1", 404)).toBeUndefined();
  });
});
