import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getLinearConfig } from "@/lib/config/linear";
import { getPublicConfig } from "@/lib/config/public";
import { upsertLinearWorkspace } from "@/lib/db/linear-workspaces";
import { linearGraphQL } from "@/lib/linear/client";
import { encryptLinearToken } from "@/lib/linear/token";
import { requireSeededOrganizationId } from "@/lib/org/seeded-organization";
import { getServerSession } from "@/lib/session/get-server-session";

function getAppUrl(req: Request): string {
  return getPublicConfig().appUrl ?? new URL(req.url).origin;
}

function errorRedirect(url: URL): NextResponse {
  const response = NextResponse.redirect(url);
  response.cookies.delete("linear_oauth_state");
  return response;
}

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  scope: z.string().optional(),
  expires_in: z.number().optional(),
});

const viewerResponseSchema = z.object({
  viewer: z.object({
    id: z.string(),
    organization: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .nullable(),
  }),
});

export async function GET(req: Request): Promise<Response> {
  const errorUrl = new URL("/settings/connections?linear=error", req.url);

  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("linear_oauth_state")?.value;

  const requestUrl = new URL(req.url);
  const stateParam = requestUrl.searchParams.get("state");
  const code = requestUrl.searchParams.get("code");

  if (!storedState || !stateParam || storedState !== stateParam) {
    return errorRedirect(errorUrl);
  }

  if (!code) {
    return errorRedirect(errorUrl);
  }

  try {
    const appUrl = getAppUrl(req);
    const redirectUri = `${appUrl}/api/linear/callback`;

    const { clientId, clientSecret } = getLinearConfig();
    if (!clientId || !clientSecret) {
      throw new Error("LINEAR_CLIENT_ID or LINEAR_CLIENT_SECRET is not set");
    }

    // Exchange code for token
    const tokenRes = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(
        `Token exchange failed: ${tokenRes.status} ${tokenRes.statusText}`,
      );
    }

    const tokenJson = await tokenRes.json();
    const tokenData = tokenResponseSchema.parse(tokenJson);
    const token = tokenData.access_token;

    // Query Linear for workspace info
    const execute = linearGraphQL(token);
    const viewerData = await execute<z.infer<typeof viewerResponseSchema>>(
      `query { viewer { id organization { id name } } }`,
    );

    if (!viewerData) {
      throw new Error("Failed to retrieve Linear workspace info");
    }

    const parsed = viewerResponseSchema.parse(viewerData);

    if (!parsed.viewer.organization) {
      const orgRequired = new URL(
        "/settings/connections?linear=org_required",
        req.url,
      );
      const response = NextResponse.redirect(orgRequired);
      response.cookies.delete("linear_oauth_state");
      return response;
    }

    const workspaceId = parsed.viewer.organization.id;
    const workspaceName = parsed.viewer.organization.name;

    // Encrypt token and upsert workspace
    const encryptedToken = encryptLinearToken(token);
    // Owned by the organization from the moment it is created, rather than
    // created ownerless and claimed later — there is no window in which the
    // connection belongs to nobody.
    await upsertLinearWorkspace({
      workspaceId,
      workspaceName,
      accessToken: encryptedToken,
      installedByUserId: session.user.id,
      organizationId: await requireSeededOrganizationId(),
    });

    const response = NextResponse.redirect(
      new URL("/settings/connections?linear=connected", req.url),
    );
    response.cookies.delete("linear_oauth_state");
    return response;
  } catch (error) {
    console.error("Linear OAuth callback error:", error);
    return errorRedirect(errorUrl);
  }
}
