import { z } from "zod";
import {
  deleteInstallationsNotInList,
  upsertInstallation,
} from "@/lib/db/installations";

const userInstallationSchema = z.object({
  id: z.number(),
  repository_selection: z.enum(["all", "selected"]),
  html_url: z.string().url().nullable().optional(),
  account: z.object({
    // GitHub's immutable numeric account id. Optional so an unexpected payload
    // degrades to "this installation stays personal" rather than failing the
    // whole sync — the allowlist simply never matches it.
    id: z.number().optional(),
    login: z.string(),
    type: z.string(),
  }),
});

const userInstallationsResponseSchema = z.object({
  installations: z.array(userInstallationSchema),
});

export class GitHubInstallationsSyncError extends Error {
  readonly status: number;
  readonly responseText: string;

  constructor(
    message: string,
    options: { status: number; responseText: string },
  ) {
    super(message);
    this.name = "GitHubInstallationsSyncError";
    this.status = options.status;
    this.responseText = options.responseText;
  }
}

const GITHUB_403_AUTH_ERROR_PATTERNS = [
  "bad credentials",
  "oauth access token has expired",
  "oauth token has expired",
  "this token has expired",
  "token is expired",
  "token is invalid",
  "token was revoked",
  "requires authentication",
  "must grant your oauth app access",
];

function isGitHubInstallations403AuthError(responseText: string): boolean {
  const normalizedResponseText = responseText.toLowerCase();

  return GITHUB_403_AUTH_ERROR_PATTERNS.some((pattern) =>
    normalizedResponseText.includes(pattern),
  );
}

export function isGitHubInstallationsAuthError(error: unknown): boolean {
  if (error instanceof GitHubInstallationsSyncError) {
    if (error.status === 401) {
      return true;
    }

    if (error.status === 403) {
      return isGitHubInstallations403AuthError(error.responseText);
    }

    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();

  return (
    normalizedMessage.includes(" 401 ") ||
    (normalizedMessage.includes(" 403 ") &&
      isGitHubInstallations403AuthError(normalizedMessage))
  );
}

function normalizeAccountType(type: string): "User" | "Organization" {
  return type === "Organization" ? "Organization" : "User";
}

function isSyncableInstallation(
  installation: z.infer<typeof userInstallationSchema>,
  personalAccountLogin: string,
): boolean {
  if (installation.account.type !== "User") {
    return true;
  }

  return (
    installation.account.login.toLowerCase() ===
    personalAccountLogin.trim().toLowerCase()
  );
}

async function fetchUserInstallations(userToken: string) {
  const installations: z.infer<typeof userInstallationSchema>[] = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const url = new URL("https://api.github.com/user/installations");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new GitHubInstallationsSyncError(
        `Failed to fetch GitHub installations page ${page}: ${response.status} ${responseText}`,
        {
          status: response.status,
          responseText,
        },
      );
    }

    const json = await response.json();
    const parsed = userInstallationsResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Invalid GitHub installations response on page ${page}`);
    }

    const currentPageInstallations = parsed.data.installations;
    installations.push(...currentPageInstallations);

    if (currentPageInstallations.length < perPage) {
      break;
    }

    page += 1;
  }

  return installations;
}

export async function syncUserInstallations(
  userId: string,
  userToken: string,
  personalAccountLogin: string,
): Promise<number> {
  const installations = await fetchUserInstallations(userToken);
  const syncableInstallations = installations.filter((installation) =>
    isSyncableInstallation(installation, personalAccountLogin),
  );

  for (const installation of syncableInstallations) {
    await upsertInstallation({
      userId,
      installationId: installation.id,
      accountId: installation.account.id ?? null,
      accountLogin: installation.account.login,
      accountType: normalizeAccountType(installation.account.type),
      repositorySelection: installation.repository_selection,
      installationUrl: installation.html_url ?? null,
    });
  }

  // Prunes this user's *personal* records only — `deleteInstallationsNotInList`
  // filters on `organization_id IS NULL`. `GET /user/installations` answers
  // "what can this user see", which is not a safe basis for deleting a record
  // the whole organization depends on: a member who leaves the GitHub
  // organization would otherwise remove it for everyone on their next sync.
  await deleteInstallationsNotInList(
    userId,
    syncableInstallations.map((installation) => installation.id),
  );

  return syncableInstallations.length;
}
