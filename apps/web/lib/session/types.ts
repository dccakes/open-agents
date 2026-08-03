export interface Session {
  created: number;
  authProvider: "vercel" | "github";
  user: {
    id: string;
    username: string;
    email: string | undefined;
    avatar: string;
    name?: string;
  };
}

export interface SessionUserInfo {
  user: Session["user"] | undefined;
  authProvider?: "vercel" | "github";
  /**
   * Signed in, but holding no membership row — the client uses this to route
   * to the approval-request screen. Server-side enforcement never consults it.
   */
  isPendingApproval?: boolean;
  isAdmin?: boolean;
  isManagedTemplateTrialUser?: boolean;
  hasGitHub?: boolean;
  hasGitHubAccount?: boolean;
  hasGitHubInstallations?: boolean;
}
