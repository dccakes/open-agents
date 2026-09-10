import { createHmac } from "crypto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

interface CreateSessionInput {
  session: {
    id: string;
    userId: string;
    title: string;
    repoOwner: string | null;
    repoName: string | null;
    branch: string | null;
    cloneUrl: string | null;
    linearIssueId: string;
    linearIssueUrl: string;
    linearAgentSessionId: string;
  };
  initialChat: {
    id: string;
    title: string;
    modelId: string;
  };
}

interface CommentCall {
  token: string;
  issueId: string;
  body: string;
}

interface ThoughtCall {
  token: string;
  agentSessionId: string;
  body: string;
}

const WEBHOOK_SECRET = "linear-test-secret";

let afterCallbacks: Array<() => Promise<void>>;
let workspaceToken: string | null;
let thoughtCalls: ThoughtCall[];
let thoughtError: Error | null;
let commentCalls: CommentCall[];
let commentError: Error | null;
let issueResult: { id: string; title: string } | null;
let issueError: Error | null;
let selectQueue: unknown[][];
let createSessionCalls: CreateSessionInput[];
let actorResolution:
  | { ok: true; userId: string }
  | { ok: false; reason: "not-connected" | "no-identity" };
let actorError: Error | null;

mock.module("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    afterCallbacks.push(callback);
  },
}));

function makeSelectChain() {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => selectQueue.shift() ?? [],
  };
  return chain;
}

mock.module("@/lib/db/client", () => ({
  db: {
    select: () => makeSelectChain(),
  },
}));

mock.module("@/lib/db/sessions", () => ({
  createSessionWithInitialChat: async (input: CreateSessionInput) => {
    createSessionCalls.push(input);
  },
}));

mock.module("@/lib/linear/token", () => ({
  getLinearWorkspaceToken: async () => workspaceToken,
}));

mock.module("@/lib/linear/activities", () => ({
  postLinearThoughtActivity: async (
    token: string,
    agentSessionId: string,
    body: string,
  ) => {
    thoughtCalls.push({ token, agentSessionId, body });
    if (thoughtError) {
      throw thoughtError;
    }
  },
  postLinearComment: async (token: string, issueId: string, body: string) => {
    commentCalls.push({ token, issueId, body });
    if (commentError) {
      throw commentError;
    }
  },
}));

mock.module("@/lib/linear/issues", () => ({
  getLinearIssue: async () => {
    if (issueError) {
      throw issueError;
    }
    return issueResult;
  },
  buildIssueContextBlock: (issue: { title: string }) =>
    `\n\n<issue>${issue.title}</issue>`,
}));

mock.module("@/lib/linear/resolve-actor", () => ({
  resolveApprovedLinearActor: async (
    actorEmail: string | undefined,
    actorLinearUserId?: string | undefined,
  ) => {
    if (actorError) {
      throw actorError;
    }

    if (!actorEmail && !actorLinearUserId) {
      return { ok: false, reason: "no-identity" };
    }

    return actorResolution;
  },
}));

mock.module("@/lib/org/agent-runs-gate", () => ({
  checkAgentRunStartAllowed: async () => ({ allowed: true }),
}));

const routeModulePromise = import("./route");

const originalError = console.error;
const originalWarn = console.warn;
let consoleMessages: string[];

console.error = (...args: unknown[]) => {
  consoleMessages.push(args.map(String).join(" "));
};
console.warn = (...args: unknown[]) => {
  consoleMessages.push(args.map(String).join(" "));
};

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});

function sign(payload: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function webhookRequest({
  payload,
  signature,
  omitSignature = false,
}: {
  payload: unknown;
  signature?: string;
  omitSignature?: boolean;
}): Request {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const headers = new Headers();

  if (!omitSignature) {
    headers.set("linear-signature", signature ?? sign(body));
  }

  return new Request("http://localhost/api/linear/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function agentSessionPayload(
  overrides: {
    type?: string;
    action?: string;
    id?: string;
    issue?: { id: string; url: string } | null;
    actor?: { email?: string; name?: string };
  } = {},
) {
  const {
    type = "AgentSession",
    action = "created",
    id = "agent-session-1",
    issue = { id: "issue-1", url: "https://linear.app/issue/ENG-1" },
    actor = { email: "dev@example.com", name: "dev" },
  } = overrides;

  return {
    type,
    action,
    data: {
      id,
      ...(issue ? { issue } : {}),
      ...(actor ? { actor } : {}),
    },
  };
}

async function flushAfter(): Promise<void> {
  const callbacks = afterCallbacks.splice(0);
  for (const callback of callbacks) {
    await callback();
  }
}

beforeEach(() => {
  process.env.LINEAR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  afterCallbacks = [];
  workspaceToken = "lin_token";
  thoughtCalls = [];
  thoughtError = null;
  commentCalls = [];
  commentError = null;
  issueResult = { id: "issue-1", title: "Fix the thing" };
  issueError = null;
  // existing-session lookup, last-session lookup
  selectQueue = [[], []];
  createSessionCalls = [];
  actorResolution = { ok: true, userId: "user-1" };
  actorError = null;
  consoleMessages = [];
});

describe("POST /api/linear/webhook (transport)", () => {
  test("returns 500 when the webhook secret is not configured", async () => {
    process.env.LINEAR_WEBHOOK_SECRET = "";
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ payload: agentSessionPayload() }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "LINEAR_WEBHOOK_SECRET is not configured",
    });
  });

  test("returns 401 when the signature header is missing", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ payload: agentSessionPayload(), omitSignature: true }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Missing signature" });
  });

  test("returns 401 for a signature produced with the wrong secret", async () => {
    const { POST } = await routeModulePromise;
    const body = JSON.stringify(agentSessionPayload());

    const response = await POST(
      webhookRequest({ payload: body, signature: sign(body, "nope") }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid signature" });
  });

  test("returns 401 for a signature of a different length", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ payload: agentSessionPayload(), signature: "abc" }),
    );

    expect(response.status).toBe(401);
  });

  test("returns 401 when the body is tampered with after signing", async () => {
    const { POST } = await routeModulePromise;
    const signed = JSON.stringify(agentSessionPayload({ id: "agent-1" }));
    const tampered = JSON.stringify(agentSessionPayload({ id: "agent-2" }));

    const response = await POST(
      webhookRequest({ payload: tampered, signature: sign(signed) }),
    );

    expect(response.status).toBe(401);
  });

  test("returns 400 for a correctly signed but unparsable body", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(webhookRequest({ payload: "{ nope" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON" });
  });

  test("ignores events that are not AgentSession", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ payload: agentSessionPayload({ type: "Issue" }) }),
    );

    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(afterCallbacks).toHaveLength(0);
  });

  test("ignores payloads that do not match the schema", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ payload: { type: "AgentSession", action: "created" } }),
    );

    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(afterCallbacks).toHaveLength(0);
  });

  test("ignores AgentSession events without an issue", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ payload: agentSessionPayload({ issue: null }) }),
    );

    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(afterCallbacks).toHaveLength(0);
  });

  test("acknowledges immediately and defers the work", async () => {
    const { POST } = await routeModulePromise;

    const response = await POST(
      webhookRequest({ payload: agentSessionPayload() }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(afterCallbacks).toHaveLength(1);
    expect(createSessionCalls).toHaveLength(0);
  });

  test("swallows deferred handler errors", async () => {
    actorError = new Error("actor resolution failed");
    const { POST } = await routeModulePromise;

    await POST(webhookRequest({ payload: agentSessionPayload() }));
    const [callback] = afterCallbacks;
    // The route wraps the handler so a rejection never escapes into `after`.
    expect(callback).toBeDefined();
    await flushAfter();

    expect(createSessionCalls).toHaveLength(0);
  });
});

describe("POST /api/linear/webhook (deferred handling)", () => {
  async function postAndFlush(payload: unknown = agentSessionPayload()) {
    const { POST } = await routeModulePromise;
    const response = await POST(webhookRequest({ payload }));
    await flushAfter();
    return response;
  }

  test("stops when no workspace token is available", async () => {
    workspaceToken = null;

    await postAndFlush();

    expect(thoughtCalls).toHaveLength(0);
    expect(createSessionCalls).toHaveLength(0);
    expect(consoleMessages.join("\n")).toContain("No workspace token");
  });

  test("posts an acknowledgement thought activity", async () => {
    await postAndFlush();

    expect(thoughtCalls).toHaveLength(1);
    expect(thoughtCalls[0]?.token).toBe("lin_token");
    expect(thoughtCalls[0]?.agentSessionId).toBe("agent-session-1");
    expect(thoughtCalls[0]?.body).toContain("spinning up a session");
  });

  test("continues when the thought activity fails to post", async () => {
    thoughtError = new Error("linear down");

    await postAndFlush();

    expect(createSessionCalls).toHaveLength(1);
    expect(consoleMessages.join("\n")).toContain(
      "Failed to post thought activity",
    );
  });

  test("stops without creating a session when the actor has no email", async () => {
    await postAndFlush(agentSessionPayload({ actor: { name: "dev" } }));

    expect(createSessionCalls).toHaveLength(0);
    expect(commentCalls).toHaveLength(0);
    expect(consoleMessages.join("\n")).toContain("No actor identity");
  });

  test("comments with a sign-in prompt for an unknown user", async () => {
    actorResolution = { ok: false, reason: "not-connected" };

    await postAndFlush();

    expect(createSessionCalls).toHaveLength(0);
    expect(commentCalls).toHaveLength(1);
    expect(commentCalls[0]?.issueId).toBe("issue-1");
    expect(commentCalls[0]?.body).toContain("@dev");
    expect(commentCalls[0]?.body).toContain("dev@example.com");
    expect(commentCalls[0]?.body).toContain("https://app.example.com");
  });

  test("falls back to the email when the actor has no name", async () => {
    actorResolution = { ok: false, reason: "not-connected" };

    await postAndFlush(
      agentSessionPayload({ actor: { email: "dev@example.com" } }),
    );

    expect(commentCalls[0]?.body).toStartWith("Hey dev@example.com,");
  });

  test("does not throw when the not-connected comment fails", async () => {
    actorResolution = { ok: false, reason: "not-connected" };
    commentError = new Error("comment failed");

    await postAndFlush();

    expect(consoleMessages.join("\n")).toContain(
      "Failed to post refusal comment",
    );
  });

  test("is idempotent for an agent session that already has a session", async () => {
    selectQueue = [[{ id: "existing-session" }], []];

    await postAndFlush();

    expect(createSessionCalls).toHaveLength(0);
  });

  test("creates a session inheriting the user's most recent repo", async () => {
    selectQueue = [
      [],
      [
        {
          repoOwner: "octo-org",
          repoName: "hello-world",
          branch: "main",
          cloneUrl: "https://github.com/octo-org/hello-world.git",
        },
      ],
    ];

    await postAndFlush();

    expect(createSessionCalls).toHaveLength(1);
    const created = createSessionCalls[0];
    expect(created?.session.userId).toBe("user-1");
    expect(created?.session.repoOwner).toBe("octo-org");
    expect(created?.session.repoName).toBe("hello-world");
    expect(created?.session.branch).toBe("main");
    expect(created?.session.linearIssueId).toBe("issue-1");
    expect(created?.session.linearIssueUrl).toBe(
      "https://linear.app/issue/ENG-1",
    );
    expect(created?.session.linearAgentSessionId).toBe("agent-session-1");
    expect(created?.initialChat.title).not.toContain(
      "Which repository should I work in?",
    );
  });

  test("asks which repository to use when the user has no prior session", async () => {
    selectQueue = [[], []];

    await postAndFlush();

    const created = createSessionCalls[0];
    expect(created?.session.repoOwner).toBeNull();
    expect(created?.session.repoName).toBeNull();
    expect(created?.initialChat.title).toContain(
      "Which repository should I work in?",
    );
  });

  test("asks which repository to use when the last session had no repo", async () => {
    selectQueue = [
      [],
      [{ repoOwner: null, repoName: null, branch: null, cloneUrl: null }],
    ];

    await postAndFlush();

    expect(createSessionCalls[0]?.initialChat.title).toContain(
      "Which repository should I work in?",
    );
  });

  test("appends the issue context block to the initial message", async () => {
    await postAndFlush();

    expect(createSessionCalls[0]?.initialChat.title).toContain(
      "<issue>Fix the thing</issue>",
    );
  });

  test("still creates the session when the issue fetch fails", async () => {
    issueError = new Error("linear api down");

    await postAndFlush();

    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]?.initialChat.title).not.toContain("<issue>");
    expect(consoleMessages.join("\n")).toContain(
      "Failed to fetch issue content",
    );
  });

  test("omits the context block when the issue is not found", async () => {
    issueResult = null;

    await postAndFlush();

    expect(createSessionCalls[0]?.initialChat.title).not.toContain("<issue>");
  });
});
