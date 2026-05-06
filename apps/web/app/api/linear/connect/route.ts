import { generateState } from "arctic";
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "@/lib/session/get-server-session";

const COOKIE_OPTIONS = {
  path: "/",
  secure: process.env.NODE_ENV === "production",
  httpOnly: true,
  maxAge: 60 * 15,
  sameSite: "lax" as const,
};

function getAppUrl(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL("/settings/connections?linear=not_configured", req.url),
    );
  }

  const state = generateState();
  const appUrl = getAppUrl(req);
  const redirectUri = `${appUrl}/api/linear/callback`;

  const authUrl = new URL("https://linear.app/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    "read,write,app:mentionable,app:assignable",
  );
  authUrl.searchParams.set("actor", "app");
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("linear_oauth_state", state, COOKIE_OPTIONS);
  return response;
}
