## Context

This change was split out of `org-roles-and-settings` after an adversarial review judged that change too large for one workstream (six capabilities, ~50 tasks, against the landed `config-boundary`'s one capability and ~20). It carries the two capabilities that gate and record shared-configuration *lifecycle*, and depends entirely on the permission model established there.

Relevant existing state: `apps/web/app/api/linear/connect/route.ts` and the disconnect path are reachable by any signed-in user; `apps/web/lib/linear/webhook.ts` generates a webhook secret with `randomBytes(32)` and stores it on `linearWorkspaces`, while `apps/web/app/api/linear/webhook/route.ts` verifies against a `LINEAR_WEBHOOK_SECRET` env var; `githubInstallations` rows are per-user with no shared concept.

## Goals / Non-Goals

**Goals:**
- No destructive action on shared configuration is one click away, or irreversible within 14 days.
- Every shared-config mutation has an actor and a timestamp on record — the seed of the Phase 2 audit log alongside WS-1.1's `policy_event`.
- One source of truth for the Linear webhook secret, so restore is actually safe.

**Non-Goals:**
- A general-purpose audit log over all application activity. This covers shared *configuration*, not agent runs or chat.
- Per-resource ACLs on integrations (which admin may touch which integration). Phase 2.
- Undo for anything other than the enumerated destructive actions.

## Decisions

### 1. The transactional audit guarantee is scoped by mutation class

- **Decision:** mutations this application owns — org settings, integration connect/disconnect, provider enablement, observability configuration — write their audit row in the **same transaction** as the mutation, so an audited action cannot succeed unaudited. Mutations mediated by Better Auth's plugin APIs — membership approve, role change, member removal — are audited **best-effort** from the plugin's `afterAddMember` / `afterUpdateMemberRole` / `afterRemoveMember` hooks.
- **Rationale:** Better Auth executes its own adapter writes and its organization hooks are not enrolled in any caller-supplied transaction. For plugin-mediated mutations you can have the plugin APIs *or* the transactional guarantee, not both — and abandoning the plugin APIs would defeat the whole reason `org-roles-and-settings` adopted the plugin. An earlier draft asserted a blanket "same transaction as the mutation" rule, which was not implementable for half the mutations it covered.
- **Consequence, stated rather than hidden:** a plugin-mediated membership change can in principle commit while its audit row fails to write. The hook failure is reported to the error tracker (WS-1.5's Sentry), and the audit trail is documented as authoritative-for-app-owned-config, best-effort-for-membership. If membership auditing later needs the stronger guarantee, the fix is a periodic reconciliation against `org_members`, not a fake transaction.

### 2. Soft delete is a `deletedAt` column, not a separate archive table

- **Decision:** destructive actions set `deletedAt` and disable the record. Read paths filter it out, so a soft-deleted integration behaves as absent to every consumer. A purge job removes rows past the 14-day window.
- **Rationale:** the restore path has to reproduce the record exactly — including the Linear webhook secret, which is what makes restore work at all. Copying rows to an archive table and back is more moving parts for the same result, and every copy is a chance to drop a column.
- **Filtering is the risk.** A read path that forgets `deletedAt IS NULL` resurrects a disconnected integration. Access goes through the existing per-table helpers (`apps/web/lib/db/linear-workspaces.ts` and equivalents) rather than ad-hoc queries, so the filter lives in one place per table.

### 3. Linear webhook secret: the workspace record is the source of truth

- **Decision:** `linearWorkspaces.webhookSecret` is authoritative. The webhook route stops reading `LINEAR_WEBHOOK_SECRET`, and the variable is removed from `lib/config/linear.ts` rather than left as a silent fallback.
- **Rationale:** two sources of truth is precisely why a restore path would be unsafe. The secret is generated locally by `registerLinearWebhook` (`apps/web/lib/linear/webhook.ts:50`, `randomBytes(32)`) and *supplied* to Linear at registration, then stored on the row — so the row is the only place that necessarily matches what Linear signs with. Restoring a connection restores that row; a rotation that updated only an env var would leave verification failing with no signal. (An earlier draft of this rationale claimed the secret was generated *by Linear*. It is not; the conclusion is unchanged but the premise was wrong.)
- **Ground-rule tension, acknowledged:** the Phase 1 ground rules say integration tokens live in env, never DB rows, because preview deployments get a Neon fork of production. The webhook secret is not an access token — it grants no API access, only signature verification — but it is still forked into previews. Encryption at rest does not fix that: `lib/config/auth.ts` documents that `BETTER_AUTH_SECRET` also derives the AES key for the stored Linear workspace token, and that secret is shared with previews, so a preview can decrypt what it forked. The real mitigation is behavioral — webhook-triggered runs are gated on `VERCEL_ENV === "production"` in WS-1.3, so a preview holding a valid secret still starts no run. Per-preview `BETTER_AUTH_SECRET` is the durable fix and belongs to whichever workstream owns preview secret isolation.

### 4. Existing GitHub installations stay personal

- **Decision (amended):** ownership is a non-NULL `github_installations.organization_id`, set only when an admin claims the installation's GitHub *account* in `org_github_accounts`. The migration marks **nothing** as org-owned. The original `isOrgShared` boolean is **not** added.
- **Rationale, unchanged:** marking existing installations org-shared on migration would broaden who can act on them at deploy time, silently, based on a guess about intent. Marking none is the only default that cannot widen access. The cost is that an admin has to opt in, once.
- **Why the mechanism changed:** `isOrgShared` is a flag on a row, and a row is an *installation*. Uninstalling and reinstalling the GitHub App issues a **new** `installation_id` — a new row, with the flag back to false — so sharing would silently lapse at exactly the moment nobody is watching, surfacing only as a teammate's `no_installation`. Keying on GitHub's immutable numeric `account.id` survives both reinstalls and org renames. The flag also had nothing to say about the duplicate rows the old `(user_id, installation_id)` key produced: one installation was N rows, and setting a boolean on them leaves N rows and no single answer.
- **Delivered by:** `org-owned-integrations`, which this change now consumes rather than duplicates. Its `lib/db/ownership-schema.test.ts` pins the column and index shape.

### 5. The purge job is production-only, and the boundary is exclusive

- **Decision:** the handler returns early unless `VERCEL_ENV === "production"`, and purges records soft-deleted *strictly more* than 14 days ago.
- **Rationale:** preview databases are forks of production whose rows reference **real** Vercel snapshots, GitHub installations, and Linear webhooks — a preview purge would destroy production resources. This is a Phase 1 ground rule, not a local preference. The exclusive boundary means a record deleted exactly 14 days ago is still restorable, which is the reading a user expects from "restore within 14 days".

## Open Questions

1. **Which existing `githubInstallations` become org-shared.** Decision 4 defaults to none. If the intent is that specific installations should be shared from day one, that is a data decision someone has to make explicitly — flag it before the migration runs.
2. **Whether observability configuration lands here or in WS-1.2.** This change defines the `observability.configure` gate and audits it; WS-1.2 builds the configuration surface behind it. If WS-1.2 slips, the gate ships guarding nothing, which is harmless but worth noting in review.
