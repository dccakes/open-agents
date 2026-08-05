import { sql } from "drizzle-orm";
import type { SandboxProviderType, SandboxState } from "@open-agents/sandbox";
import type { ModelVariant } from "@/lib/model-variants";
import type { DbTeardownMetadata } from "@/lib/sandbox/db-provisioner";
import type { GlobalSkillRef } from "@/lib/skills/global-skill-refs";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// users
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  // Superseded by `role` (better-auth admin plugin). Kept for one deploy so a
  // rolling release's previous code can still read it; dropped in a later PR.
  isAdmin: boolean("is_admin").notNull().default(false),
  // better-auth admin plugin. Every declared field must exist as a column:
  // the adapter rejects an insert naming a column the Drizzle schema lacks.
  role: text("role").notNull().default("user"),
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at").defaultNow().notNull(),
});

// oauth provider accounts
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// better-auth sessions
export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // better-auth organization plugin. NULL on sessions issued before the
  // organization existed, which is why `requirePermission()` resolves the
  // seeded organization explicitly instead of trusting this field.
  activeOrganizationId: text("active_organization_id"),
  // better-auth admin plugin.
  impersonatedBy: text("impersonated_by"),
});

// better-auth verification tokens
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// better-auth organization plugin — `organization` model.
// `metadata` is a plugin column and must exist even though nothing in this
// change stores anything in it: org settings live in their own typed table.
export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // The seeder's concurrency guard: two boots racing to insert converge on one
  // row through this constraint rather than through check-then-insert.
  (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)],
);

// better-auth organization plugin — `member` model.
export const orgMembers = pgTable(
  "org_members",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("org_members_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    index("org_members_user_id_idx").on(table.userId),
  ],
);

// better-auth organization plugin — `invitation` model.
export const orgInvitations = pgTable(
  "org_invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("org_invitations_organization_id_idx").on(table.organizationId),
    index("org_invitations_email_idx").on(table.email),
  ],
);

// Organization-wide settings.
//
// Keyed by a unique `organizationId` rather than a fixed singleton id, so the
// Phase 2 multi-org migration is a no-op for this table. The columns are typed
// rather than living in the organization plugin's `metadata` JSON: the kill
// switch is read before every run start, and a malformed blob must not be able
// to fail open into "runs allowed".
//
// The row itself is created by the runtime seeder (`lib/org/seed.ts`), not by a
// migration — migrations are static SQL and cannot read configuration.
export const orgSettings = pgTable(
  "org_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Stops *new* runs in this deployment. In-flight runs are unaffected;
    // terminating those is WS-1.5's per-run stop.
    agentRunsPaused: boolean("agent_runs_paused").notNull().default(false),
    // NULL means unlimited. Stored and gated here; enforcement is WS-1.1's.
    dailyTokenBudget: integer("daily_token_budget"),
    // The Vercel team the organization's projects live under — the org's
    // tie-in to Vercel, as distinct from the per-user Vercel OAuth identity
    // that actually performs API calls. NULL means "not recorded yet".
    vercelTeamId: text("vercel_team_id"),
    vercelTeamSlug: text("vercel_team_slug"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("org_settings_organization_id_idx").on(table.organizationId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrgMember = typeof orgMembers.$inferSelect;
export type NewOrgMember = typeof orgMembers.$inferInsert;
export type OrgInvitation = typeof orgInvitations.$inferSelect;
export type NewOrgInvitation = typeof orgInvitations.$inferInsert;
export type OrgSettingsRow = typeof orgSettings.$inferSelect;
export type NewOrgSettingsRow = typeof orgSettings.$inferInsert;

// GitHub accounts the organization claims as its own.
//
// The promotion key is `accountId` — GitHub's immutable numeric account id —
// not the login and not the installation id. Logins are rename-able, and an
// uninstall/reinstall cycle issues a *new* installation id, so an allowlist
// keyed by either would silently stop applying at exactly the moment nobody is
// watching. `accountLogin` is carried for display only.
//
// `accountType` is constrained to `Organization` at the type level because a
// personal GitHub account is never promotable: sharing one would hand the
// whole organization access to a member's private repositories.
export const orgGitHubAccounts = pgTable(
  "org_github_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", { enum: ["Organization"] })
      .notNull()
      .default("Organization"),
    addedByUserId: text("added_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("org_github_accounts_org_account_idx").on(
      table.organizationId,
      table.accountId,
    ),
  ],
);

// GitHub App installations.
//
// Ownership is discriminated by `organizationId`: non-NULL means the
// organization owns this installation and exactly one row represents it;
// NULL means the row is personal to `userId`.
//
// `userId` stays NOT NULL in both modes, but its *meaning* changes with
// ownership — on an org-owned row it is provenance ("who installed it"), not
// authority. Nothing resolves an org-owned installation through it. The column
// keeps its name rather than being renamed to `installed_by_user_id`: a rename
// during the expand step risks drizzle-kit emitting drop-and-add instead of
// `ALTER ... RENAME`, and the semantic point is carried by the resolver
// signatures, which take no user id at all.
export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Non-NULL ⇒ organization-owned. See the ownership note above.
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    installationId: integer("installation_id").notNull(),
    // GitHub's immutable numeric account id, matched against the allowlist.
    // Nullable because rows written before this column existed have none; the
    // backfill fills what it can resolve and leaves the rest personal.
    accountId: integer("account_id"),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type", {
      enum: ["User", "Organization"],
    }).notNull(),
    repositorySelection: text("repository_selection", {
      enum: ["all", "selected"],
    }).notNull(),
    installationUrl: text("installation_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("github_installations_user_installation_idx").on(
      table.userId,
      table.installationId,
    ),
    uniqueIndex("github_installations_user_account_idx").on(
      table.userId,
      table.accountLogin,
    ),
    // "Exactly one organization-owned row per installation", enforced by the
    // database rather than by the promotion routine remembering. Partial, so
    // the personal rows this does not govern are unaffected.
    uniqueIndex("github_installations_org_installation_idx")
      .on(table.organizationId, table.installationId)
      .where(sql`${table.organizationId} IS NOT NULL`),
  ],
);

// Repository → Vercel project links.
//
// Keyed by the *repository*, not by the person: which project a repo deploys
// to is a fact about the repo, and the primary key is what makes "one answer
// per repository" true rather than a rule someone has to remember. `userId` is
// provenance — who set it — and carries no authority.
//
// Deleting a user leaves the link standing (`set null`): the organization's
// deployment target must not disappear because the person who recorded it did.
export const vercelProjectLinks = pgTable(
  "vercel_project_links",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").notNull(),
    projectName: text("project_name").notNull(),
    teamId: text("team_id"),
    teamSlug: text("team_slug"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.repoOwner, table.repoName],
    }),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "archived"],
    })
      .notNull()
      .default("running"),
    // Repository info
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    branch: text("branch"),
    cloneUrl: text("clone_url"),
    vercelProjectId: text("vercel_project_id"),
    vercelProjectName: text("vercel_project_name"),
    vercelTeamId: text("vercel_team_id"),
    vercelTeamSlug: text("vercel_team_slug"),
    // Whether this session uses a new auto-generated branch
    isNewBranch: boolean("is_new_branch").default(false).notNull(),
    // Optional per-session override for auto commit + push behavior.
    // null means "use the user's default preference".
    autoCommitPushOverride: boolean("auto_commit_push_override"),
    // Optional per-session override for auto PR creation after auto-commit.
    // null means "use the user's default preference".
    autoCreatePrOverride: boolean("auto_create_pr_override"),
    // Security posture. Lives on the session rather than the chat so a user
    // cannot escape a `strict` posture by opening a second chat. `auto` is the
    // default precisely because it is what every session did before the column
    // existed, so the migration changes no behaviour.
    posture: text("posture", {
      enum: ["strict", "auto", "dangerous"],
    })
      .notNull()
      .default("auto"),
    globalSkillRefs: jsonb("global_skill_refs")
      .$type<GlobalSkillRef[]>()
      .notNull()
      .default([]),
    provisionDb: boolean("provision_db").notNull().default(false),
    // Unified sandbox state
    sandboxState: jsonb("sandbox_state").$type<SandboxState>(),
    dbTeardownMetadata: jsonb(
      "db_teardown_metadata",
    ).$type<DbTeardownMetadata>(),
    // Lifecycle orchestration state for sandbox management
    lifecycleState: text("lifecycle_state", {
      enum: [
        "provisioning",
        "active",
        "hibernating",
        "hibernated",
        "restoring",
        "archived",
        "failed",
      ],
    }),
    lifecycleVersion: integer("lifecycle_version").notNull().default(0),
    lastActivityAt: timestamp("last_activity_at"),
    sandboxExpiresAt: timestamp("sandbox_expires_at"),
    hibernateAfter: timestamp("hibernate_after"),
    lifecycleRunId: text("lifecycle_run_id"),
    sandboxProvisioningRunId: text("sandbox_provisioning_run_id"),
    lifecycleError: text("lifecycle_error"),
    // Git stats (for display in session list)
    linesAdded: integer("lines_added").default(0),
    linesRemoved: integer("lines_removed").default(0),
    // PR info if created
    prNumber: integer("pr_number"),
    prStatus: text("pr_status", {
      enum: ["open", "merged", "closed"],
    }),
    // Snapshot info (for cached snapshots feature)
    snapshotUrl: text("snapshot_url"),
    snapshotCreatedAt: timestamp("snapshot_created_at"),
    snapshotSizeBytes: integer("snapshot_size_bytes"),
    // Cached diff for offline viewing
    cachedDiff: jsonb("cached_diff"),
    cachedDiffUpdatedAt: timestamp("cached_diff_updated_at"),
    // Linear integration
    linearIssueId: text("linear_issue_id"),
    linearIssueUrl: text("linear_issue_url"),
    linearAgentSessionId: text("linear_agent_session_id"),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const chats = pgTable(
  "chats",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    modelId: text("model_id").default("anthropic/claude-haiku-4.5"),
    activeStreamId: text("active_stream_id"),
    lastAssistantMessageAt: timestamp("last_assistant_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("chats_session_id_idx").on(table.sessionId)],
);

export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("shares_chat_id_idx").on(table.chatId)],
);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant"],
  }).notNull(),
  // Store the full message parts as JSON for flexibility
  parts: jsonb("parts").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatReads = pgTable(
  "chat_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.chatId] }),
    index("chat_reads_chat_id_idx").on(table.chatId),
  ],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelId: text("model_id"),
    // `running` exists because the row is now written at run start. A budget
    // breach is `budget-exceeded` rather than `failed`: the run did what it was
    // asked to do and then hit a ceiling, which is not the same as an error.
    status: text("status", {
      enum: ["running", "completed", "aborted", "failed", "budget-exceeded"],
    }).notNull(),
    startedAt: timestamp("started_at").notNull(),
    // NULL while the run is in flight. A row no longer implies a finished run,
    // so every reader that means "finished" must say so — see
    // `finishedWorkflowRuns()` in `lib/db/workflow-runs.ts`.
    finishedAt: timestamp("finished_at"),
    totalDurationMs: integer("total_duration_ms"),
    // Running totals, written each step so spend is observable mid-run and a
    // resumed run does not restart its budget at zero.
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    stepCount: integer("step_count").notNull().default(0),
    /** Why the run stopped early, when it did. Names the budget and the totals. */
    haltReason: text("halt_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_runs_chat_id_idx").on(table.chatId),
    index("workflow_runs_session_id_idx").on(table.sessionId),
    index("workflow_runs_user_id_idx").on(table.userId),
  ],
);

export const workflowRunSteps = pgTable(
  "workflow_run_steps",
  {
    id: text("id").primaryKey(),
    workflowRunId: text("workflow_run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    finishReason: text("finish_reason"),
    rawFinishReason: text("raw_finish_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workflow_run_steps_run_id_idx").on(table.workflowRunId),
    uniqueIndex("workflow_run_steps_run_step_idx").on(
      table.workflowRunId,
      table.stepNumber,
    ),
  ],
);

// Approvals — the server-side record behind a policy `ask`.
//
// This table exists because the approval decision otherwise travels inside the
// client-supplied `messages[].parts` of the resume request, which makes it an
// assertion by whoever can send that request rather than an authorization.
// The row is what `execute` verifies, what `expiresAt` times out, what
// `decidedBy` attributes, and what `consumedAt` makes single-use.
//
// `workflowRunId` carries no foreign key on purpose: the `workflow_runs` row is
// not written until the run finishes, so an approval requested mid-run has a
// run id that does not exist as a row yet.
export const approvals = pgTable(
  "approval",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    // NULL for an application-level side effect, which has no chat turn.
    chatId: text("chat_id").references(() => chats.id, {
      onDelete: "cascade",
    }),
    workflowRunId: text("workflow_run_id"),
    kind: text("kind", {
      enum: ["tool-call", "app-side-effect"],
    }).notNull(),
    // NULL for an application-level side effect, which has no tool dispatch.
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    // Redacted: credential-shaped values never reach this column.
    inputSummary: jsonb("input_summary")
      .$type<Record<string, unknown>>()
      .notNull(),
    decision: text("decision", {
      enum: ["pending", "approved", "denied", "expired"],
    })
      .notNull()
      .default("pending"),
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Set the first time an execution spends this approval. Single-use: a
    // replayed message body finds it already set and is refused.
    consumedAt: timestamp("consumed_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    decidedAt: timestamp("decided_at"),
  },
  (table) => [
    // Listing a session's pending approvals.
    index("approval_session_decision_idx").on(table.sessionId, table.decision),
    // Execute-time lookup, and the guarantee that one tool call cannot be
    // gated by two competing approvals. NULLs are distinct in Postgres, so
    // application-side-effect rows are unaffected.
    uniqueIndex("approval_tool_call_id_idx").on(table.toolCallId),
    // The sweeper's scan: pending rows past their expiry.
    index("approval_decision_expires_at_idx").on(
      table.decision,
      table.expiresAt,
    ),
  ],
);

// Policy events — append-only.
//
// Insert-only by design: there is no update or delete path anywhere in the
// app, so the record of what the policy decided cannot be edited after the
// fact. That is the whole value of it.
export const policyEvents = pgTable(
  "policy_event",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    workflowRunId: text("workflow_run_id"),
    toolName: text("tool_name"),
    // Redacted, same rule as `approval.input_summary`.
    inputSummary: jsonb("input_summary")
      .$type<Record<string, unknown>>()
      .notNull(),
    // `expired` is the sweeper materializing a timeout; `downgraded` is a
    // posture resolution refusing `dangerous` for a non-interactive trigger.
    decision: text("decision", {
      enum: ["allow", "ask", "deny", "expired", "downgraded"],
    }).notNull(),
    matchedRule: text("matched_rule"),
    posture: text("posture", {
      enum: ["strict", "auto", "dangerous"],
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("policy_event_session_created_at_idx").on(
      table.sessionId,
      table.createdAt,
    ),
    index("policy_event_workflow_run_id_idx").on(table.workflowRunId),
  ],
);

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
export type PolicyEvent = typeof policyEvents.$inferSelect;
export type NewPolicyEvent = typeof policyEvents.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type VercelProjectLink = typeof vercelProjectLinks.$inferSelect;
export type NewVercelProjectLink = typeof vercelProjectLinks.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type Share = typeof shares.$inferSelect;
export type NewShare = typeof shares.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ChatRead = typeof chatReads.$inferSelect;
export type NewChatRead = typeof chatReads.$inferInsert;
export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
export type WorkflowRunStep = typeof workflowRunSteps.$inferSelect;
export type NewWorkflowRunStep = typeof workflowRunSteps.$inferInsert;
export type GitHubInstallation = typeof githubInstallations.$inferSelect;
export type NewGitHubInstallation = typeof githubInstallations.$inferInsert;

// User preferences for settings
export const userPreferences = pgTable("user_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  defaultModelId: text("default_model_id").default(
    "anthropic/claude-haiku-4.5",
  ),
  defaultSubagentModelId: text("default_subagent_model_id"),
  defaultSandboxType: text("default_sandbox_type", {
    enum: ["vercel", "docker", "daytona"],
  }).default("vercel"),
  defaultDiffMode: text("default_diff_mode", {
    enum: ["unified", "split"],
  }).default("unified"),
  autoCommitPush: boolean("auto_commit_push").notNull().default(false),
  autoCreatePr: boolean("auto_create_pr").notNull().default(false),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  alertSoundEnabled: boolean("alert_sound_enabled").notNull().default(true),
  publicUsageEnabled: boolean("public_usage_enabled").notNull().default(false),
  globalSkillRefs: jsonb("global_skill_refs")
    .$type<GlobalSkillRef[]>()
    .notNull()
    .default([]),
  modelVariants: jsonb("model_variants")
    .$type<ModelVariant[]>()
    .notNull()
    .default([]),
  enabledModelIds: jsonb("enabled_model_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

export const userSandboxConfigs = pgTable(
  "user_sandbox_configs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerType: text("provider_type", {
      enum: ["vercel", "docker", "daytona"],
    })
      .$type<SandboxProviderType>()
      .notNull(),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_sandbox_configs_user_provider_idx").on(
      table.userId,
      table.providerType,
    ),
    index("user_sandbox_configs_user_id_idx").on(table.userId),
  ],
);

export type UserSandboxConfig = typeof userSandboxConfigs.$inferSelect;
export type NewUserSandboxConfig = typeof userSandboxConfigs.$inferInsert;

// Usage tracking — one row per assistant turn (append-only)
export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Run attribution. Nullable because rows written before attribution
    // existed have neither, and because usage can be recorded outside a
    // workflow run.
    sessionId: text("session_id"),
    workflowRunId: text("workflow_run_id"),
    source: text("source", { enum: ["web"] })
      .notNull()
      .default("web"),
    agentType: text("agent_type", { enum: ["main", "subagent"] })
      .notNull()
      .default("main"),
    provider: text("provider"),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usage_events_user_id_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("usage_events_workflow_run_id_idx").on(table.workflowRunId),
  ],
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

// The Linear workspace connection.
//
// `organizationId` is what the connection is resolved by — previously it was
// whichever row happened to be oldest, which is only correct while exactly one
// row exists. `installedByUserId` is provenance: the connection survives that
// user leaving, and the OAuth grant is taken with `actor=app`, so the stored
// token is the application's rather than any person's.
//
// Backfilled at runtime by the seeder rather than by the migration, for the
// same reason `org_settings`' row is: migrations are static SQL and cannot
// know the seeded organization's id.
export const linearWorkspaces = pgTable(
  "linear_workspaces",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    workspaceId: text("workspace_id").notNull(),
    workspaceName: text("workspace_name").notNull(),
    accessToken: text("access_token").notNull(),
    webhookSecret: text("webhook_secret"),
    webhookId: text("webhook_id"),
    installedByUserId: text("installed_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("linear_workspaces_workspace_id_idx").on(table.workspaceId),
    // At most one active connection per organization.
    uniqueIndex("linear_workspaces_organization_id_idx")
      .on(table.organizationId)
      .where(sql`${table.organizationId} IS NOT NULL`),
  ],
);

// Linear identities mapped to QuackOps users by an administrator.
//
// The webhook carries no cookie, so an actor is otherwise matched by email
// string. `accountLinking.allowDifferentEmails` is enabled, which makes a
// Linear address differing from a sign-in address an ordinary state rather
// than a misconfiguration — so it needs a deliberate resolution path. This is
// that path. It is emphatically *not* a fallback identity: an actor with
// neither a verified-email match nor a row here does not resolve at all.
export const linearActorLinks = pgTable(
  "linear_actor_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The actor's Linear user id, as it appears on the webhook payload. */
    linearUserId: text("linear_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // One Linear identity resolves to exactly one QuackOps user.
    uniqueIndex("linear_actor_links_org_linear_user_idx").on(
      table.organizationId,
      table.linearUserId,
    ),
    index("linear_actor_links_user_id_idx").on(table.userId),
  ],
);

export type LinearWorkspace = typeof linearWorkspaces.$inferSelect;
export type NewLinearWorkspace = typeof linearWorkspaces.$inferInsert;
export type LinearActorLink = typeof linearActorLinks.$inferSelect;
export type NewLinearActorLink = typeof linearActorLinks.$inferInsert;
export type OrgGitHubAccount = typeof orgGitHubAccounts.$inferSelect;
export type NewOrgGitHubAccount = typeof orgGitHubAccounts.$inferInsert;
