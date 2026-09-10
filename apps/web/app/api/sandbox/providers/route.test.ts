import { describe, expect, mock, test } from "bun:test";

const testSession = { user: { id: "user-1" } };

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => testSession,
  // The chokepoint's membership-aware export. This suite covers an approved
  // member; the pending case is covered where the gate lives.
  getSessionWithMembership: async () => ({
    session: testSession,
    approved: true,
  }),
}));

mock.module("@open-agents/sandbox", () => ({
  connectSandbox: async () => ({
    stop: async () => {},
  }),
  defaultRegistry: {
    list: () => [
      {
        type: "vercel",
        label: "Vercel",
        beta: false,
        capabilities: {
          persistent: true,
          db: true,
          envInjection: true,
          credentialBrokering: true,
        },
        isAvailable: () => true,
        reasonUnavailable: () => undefined,
      },
      {
        type: "daytona",
        label: "Daytona (Beta)",
        beta: true,
        capabilities: {
          persistent: true,
          db: true,
          envInjection: true,
          credentialBrokering: true,
        },
        isAvailable: () => false,
        reasonUnavailable: () => "DAYTONA_BETA_ENABLED is not enabled",
      },
    ],
  },
}));

const routeModulePromise = import("./route");

describe("/api/sandbox/providers", () => {
  test("returns provider availability and capabilities", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET();
    const body = (await response.json()) as {
      providers: Array<{
        type: string;
        label: string;
        beta: boolean;
        capabilities: {
          persistent: boolean;
          db: boolean;
          envInjection: boolean;
          credentialBrokering: boolean;
        };
        available: boolean;
        reasonUnavailable?: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.providers).toEqual([
      {
        type: "vercel",
        label: "Vercel",
        beta: false,
        capabilities: {
          persistent: true,
          db: true,
          envInjection: true,
          credentialBrokering: true,
        },
        available: true,
      },
      {
        type: "daytona",
        label: "Daytona (Beta)",
        beta: true,
        capabilities: {
          persistent: true,
          db: true,
          envInjection: true,
          credentialBrokering: true,
        },
        available: false,
        reasonUnavailable: "DAYTONA_BETA_ENABLED is not enabled",
      },
    ]);
  });
});
