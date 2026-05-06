import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertLinearWorkspace } from "@/lib/db/linear-workspaces";
import { linearGraphQL } from "@/lib/linear/client";
import { encryptLinearToken } from "@/lib/linear/token";
import { registerLinearWebhook } from "@/lib/linear/webhook";
import { getServerSession } from "@/lib/session/get-server-session";

function getAppUrl(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
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
    organization: z.object({
      id: z.string(),
      name: z.string(),
    }),
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
    return NextResponse.redirect(errorUrl);
  }

  if (!code) {
    return NextResponse.redirect(errorUrl);
  }

  try {
    const appUrl = getAppUrl(req);
    const redirectUri = `${appUrl}/api/linear/callback`;

    const clientId = process.env.LINEAR_CLIENT_ID;
    const clientSecret = process.env.LINEAR_CLIENT_SECRET;
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
    const workspaceId = parsed.viewer.organization.id;
    const workspaceName = parsed.viewer.organization.name;

    // Register webhook
    const { webhookId, webhookSecret } = await registerLinearWebhook(token);

    // Encrypt token and upsert workspace
    const encryptedToken = encryptLinearToken(token);
    await upsertLinearWorkspace({
      workspaceId,
      workspaceName,
      accessToken: encryptedToken,
      webhookId,
      webhookSecret,
      installedByUserId: session.user.id,
    });

    const response = NextResponse.redirect(
      new URL("/settings/connections?linear=connected", req.url),
    );
    response.cookies.delete("linear_oauth_state");
    return response;
  } catch (error) {
    console.error("Linear OAuth callback error:", error);
    return NextResponse.redirect(errorUrl);
  }
}
