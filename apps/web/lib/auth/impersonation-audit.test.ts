import { beforeEach, describe, expect, mock, test } from "bun:test";
import { APIError } from "better-auth/api";

interface RecordedEvent {
  action: string;
  actorId?: string | null;
  targetId?: string | null;
}

let events: RecordedEvent[] = [];

mock.module("@/lib/audit/record", () => ({
  recordAuditEvent: (event: RecordedEvent) => {
    events.push(event);
  },
}));

const modulePromise = import("@/lib/auth/impersonation-audit");

type Middleware = (ctx: {
  path: string;
  body?: unknown;
  context: Record<string, unknown>;
}) => Promise<unknown>;

async function run(
  path: string,
  body?: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  const { impersonationAudit } = await modulePromise;
  await (impersonationAudit as unknown as Middleware)({ path, body, context });
}

beforeEach(() => {
  events = [];
});

describe("impersonationAudit", () => {
  test("ignores unrelated endpoints", async () => {
    await run("/admin/list-users", { userId: "u1" });

    expect(events).toHaveLength(0);
  });

  test("records the start of an impersonation with actor and target", async () => {
    await run(
      "/admin/impersonate-user",
      { userId: "target-1" },
      { newSession: { session: { impersonatedBy: "admin-1" } } },
    );

    expect(events).toEqual([
      {
        action: "impersonation.started",
        actorId: "admin-1",
        targetId: "target-1",
      },
    ]);
  });

  test("records the end of an impersonation", async () => {
    await run("/admin/stop-impersonating", undefined, {
      session: { session: { impersonatedBy: "admin-1" } },
    });

    expect(events).toEqual([
      {
        action: "impersonation.stopped",
        actorId: "admin-1",
        targetId: null,
      },
    ]);
  });

  // A refused attempt is not an impersonation. Recording it would make the
  // audit trail claim something that did not happen.
  test("records nothing when the plugin refused the request", async () => {
    await run(
      "/admin/impersonate-user",
      { userId: "target-1" },
      { returned: new APIError("FORBIDDEN", { message: "denied" }) },
    );

    expect(events).toHaveLength(0);
  });
});
