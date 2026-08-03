import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

interface UpsertWorkspaceCall {
  workspaceId: string;
  workspaceName: string;
  accessToken: string;
  installedByUserId: string;
}

interface TokenExchangeCall {
  url: string;
  body: URLSearchParams;
}

let authSession: { user: { id: string } } | null;
let cookieValues: Record<string, string>;
let tokenExchangeCalls: TokenExchangeCall[];
let tokenResponse: { status: number; body: unknown };
let graphqlToken: string | null;
let viewerResult: unknown;
let graphqlError: Error | null;
let upsertCalls: UpsertWorkspaceCall[];
let upsertError: Error | null;

mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieValues[name];
      return value ? { value } : undefined;
    },
  }),
}));

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/linear/client", () => ({
  linearGraphQL: (token: string) => {
    graphqlToken = token;
    return async () => {
      if (graphqlError) {
        throw graphqlError;
      }
      return viewerResult;
    };
  },
}));

mock.module("@/lib/linear/token", () => ({
  encryptLinearToken: (token: string) => `encrypted:${token}`,
}));

mock.module("@/lib/db/linear-workspaces", () => ({
  upsertLinearWorkspace: async (input: UpsertWorkspaceCall) => {
    upsertCalls.push(input);
    if (upsertError) {
      throw upsertError;
    }
  },
}));

const originalFetch = globalThis.fetch;
const originalError = console.error;
let consoleMessages: string[];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  tokenExchangeCalls.push({
    url,
    body: new URLSearchParams(String(init?.body ?? "")),
  });

  return new Response(JSON.stringify(tokenResponse.body), {
    status: tokenResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

console.error = (...args: unknown[]) => {
  consoleMessages.push(args.map(String).join(" "));
};

afterAll(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
});

const routeModulePromise = import("./route");

const STATE = "state-abc";

function callbackRequest({
  state = STATE,
  code = "auth-code",
}: { state?: string | null; code?: string | null } = {}): Request {
  const url = new URL("http://localhost/api/linear/callback");
  if (state !== null) {
    url.searchParams.set("state", state);
  }
  if (code !== null) {
    url.searchParams.set("code", code);
  }
  return new Request(url);
}

function getRedirectUrl(response: Response): URL {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  return new URL(location as string);
}

function expectStateCookieCleared(response: Response): void {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toContain("linear_oauth_state=;");
  expect(setCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
}

beforeEach(() => {
  process.env.LINEAR_CLIENT_ID = "client-id";
  process.env.LINEAR_CLIENT_SECRET = "client-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  authSession = { user: { id: "user-1" } };
  cookieValues = { linear_oauth_state: STATE };
  tokenExchangeCalls = [];
  tokenResponse = {
    status: 200,
    body: { access_token: "lin_oauth_token", token_type: "Bearer" },
  };
  graphqlToken = null;
  viewerResult = {
    viewer: {
      id: "viewer-1",
      organization: { id: "workspace-1", name: "Acme" },
    },
  };
  graphqlError = null;
  upsertCalls = [];
  upsertError = null;
  consoleMessages = [];
});

describe("GET /api/linear/callback (guards)", () => {
  test("redirects unauthenticated users home", async () => {
    authSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).pathname).toBe("/");
    expect(tokenExchangeCalls).toHaveLength(0);
  });

  test("redirects to error when no state cookie was stored", async () => {
    cookieValues = {};
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expectStateCookieCleared(response);
    expect(tokenExchangeCalls).toHaveLength(0);
  });

  test("redirects to error when the state parameter is missing", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest({ state: null }));

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expect(tokenExchangeCalls).toHaveLength(0);
  });

  test("rejects a state parameter that does not match the cookie", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest({ state: "forged-state" }));

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expectStateCookieCleared(response);
    expect(tokenExchangeCalls).toHaveLength(0);
  });

  test("redirects to error when the code is missing", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest({ code: null }));

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expect(tokenExchangeCalls).toHaveLength(0);
  });
});

describe("GET /api/linear/callback (token exchange)", () => {
  test("posts the authorization code with the configured credentials", async () => {
    const { GET } = await routeModulePromise;

    await GET(callbackRequest());

    expect(tokenExchangeCalls).toHaveLength(1);
    const call = tokenExchangeCalls[0];
    expect(call?.url).toBe("https://api.linear.app/oauth/token");
    expect(call?.body.get("grant_type")).toBe("authorization_code");
    expect(call?.body.get("code")).toBe("auth-code");
    expect(call?.body.get("client_id")).toBe("client-id");
    expect(call?.body.get("client_secret")).toBe("client-secret");
    expect(call?.body.get("redirect_uri")).toBe(
      "https://app.example.com/api/linear/callback",
    );
  });

  test("falls back to the request origin when NEXT_PUBLIC_APP_URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { GET } = await routeModulePromise;

    await GET(callbackRequest());

    expect(tokenExchangeCalls[0]?.body.get("redirect_uri")).toBe(
      "http://localhost/api/linear/callback",
    );
  });

  test("redirects to error when the client credentials are not configured", async () => {
    process.env.LINEAR_CLIENT_ID = "";
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expect(tokenExchangeCalls).toHaveLength(0);
    expect(consoleMessages.join("\n")).toContain("LINEAR_CLIENT_ID");
  });

  test("redirects to error when the token exchange fails", async () => {
    tokenResponse = { status: 400, body: { error: "invalid_grant" } };
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expectStateCookieCleared(response);
    expect(upsertCalls).toHaveLength(0);
  });

  test("redirects to error when the token response is malformed", async () => {
    tokenResponse = { status: 200, body: { token_type: "Bearer" } };
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expect(upsertCalls).toHaveLength(0);
  });
});

describe("GET /api/linear/callback (workspace resolution)", () => {
  test("redirects to error when the viewer query fails", async () => {
    graphqlError = new Error("linear graphql down");
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expect(upsertCalls).toHaveLength(0);
  });

  test("redirects to error when the viewer query returns nothing", async () => {
    viewerResult = null;
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expect(consoleMessages.join("\n")).toContain(
      "Failed to retrieve Linear workspace info",
    );
  });

  test("redirects to error when the viewer shape is unexpected", async () => {
    viewerResult = { viewer: { organization: { id: "w", name: "Acme" } } };
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expect(upsertCalls).toHaveLength(0);
  });

  test("redirects with org_required when the viewer has no organization", async () => {
    viewerResult = { viewer: { id: "viewer-1", organization: null } };
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe(
      "org_required",
    );
    expectStateCookieCleared(response);
    expect(upsertCalls).toHaveLength(0);
  });
});

describe("GET /api/linear/callback (success)", () => {
  test("stores the encrypted token and redirects as connected", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.pathname).toBe("/settings/connections");
    expect(redirectUrl.searchParams.get("linear")).toBe("connected");
    expectStateCookieCleared(response);
    expect(upsertCalls).toEqual([
      {
        workspaceId: "workspace-1",
        workspaceName: "Acme",
        accessToken: "encrypted:lin_oauth_token",
        installedByUserId: "user-1",
      },
    ]);
  });

  test("queries Linear with the freshly exchanged access token", async () => {
    const { GET } = await routeModulePromise;

    await GET(callbackRequest());

    expect(graphqlToken).toBe("lin_oauth_token");
  });

  test("redirects to error when persisting the workspace fails", async () => {
    upsertError = new Error("db down");
    const { GET } = await routeModulePromise;

    const response = await GET(callbackRequest());

    expect(getRedirectUrl(response).searchParams.get("linear")).toBe("error");
    expectStateCookieCleared(response);
  });
});
