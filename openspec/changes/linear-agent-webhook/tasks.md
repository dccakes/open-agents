## 1. Linear Activities Library

- [x] 1.1 Create `apps/web/lib/linear/activities.ts` with `postLinearThoughtActivity(token, agentSessionId, text)` — POSTs to Linear agent session API
- [x] 1.2 Add `postLinearComment(token, issueId, body)` to `apps/web/lib/linear/activities.ts` — posts a comment on a Linear issue (used for "not connected" message)

## 2. Webhook Handler

- [x] 2.1 Create `apps/web/app/api/linear/webhook/route.ts` — POST handler
- [ ] 2.2 Implement HMAC-SHA256 signature validation using `webhookSecret` from `linearWorkspaces` (timing-safe comparison, same pattern as GitHub webhook). **The HMAC mechanics are done and match the GitHub handler, but the secret comes from the wrong place.** `route.ts:54` reads `getLinearConfig().webhookSecret` — the static `LINEAR_WEBHOOK_SECRET` env var — while `lib/linear/webhook.ts:50` generates a per-workspace `randomBytes(32)` secret, registers *that* with Linear (`secret: webhookSecret`, line 59), and stores it in `linearWorkspaces.webhookSecret`. Linear therefore signs with a value the route never reads, so every genuine webhook is rejected 401 unless an operator manually mirrors the DB secret into the env var. `getLinearWorkspace()` exists in `lib/db/linear-workspaces.ts:75` and is never called from the route. Also tracked as `shared-config-governance` task 3.1.
- [ ] 2.3 Return HTTP 200 immediately after signature validation passes; return 401 for invalid signature or missing workspace. **The 200 and the two 401 paths are correct** (`route.ts:112`, `:63-65`, `:68-70`), **but "missing workspace" returns 500**, not 401 (`route.ts:55-60`), and no `linearWorkspaces` lookup happens at all. This contradicts this change's own `specs/linear-agent-webhook/spec.md:14-16`.
- [x] 2.4 Parse webhook payload with Zod schema: extract `agentSession.id`, `issue.id`, `issue.url`, `actor.email`, `actor.name` — `agentSessionEventSchema` at `route.ts:21-39`, extraction at `:89-93`; all five values are read. Open risk, not blocking this task: the handler gates on `type !== "AgentSession"` (`:80`) while registration subscribes to `resourceTypes: ["AgentSessionEvent"]` (`lib/linear/webhook.ts:57`). Confirm against a real payload.

## 3. Deferred Handler (`after()`)

- [x] 3.1 In the `after()` callback, immediately call `postLinearThoughtActivity` with "Starting on this, spinning up a session..." — `route.ts:134-139`. One `await getLinearWorkspaceToken()` precedes it, which is a prerequisite for calling Linear at all.
- [x] 3.2 Look up `actor.email` in `users` table — via `resolveApprovedLinearActor` (`lib/linear/resolve-actor.ts:32-36`), which also gates on `isApprovedMember`, returning `not-connected` / `pending` / `no-email`. Deliberate hardening beyond the task text: this path has no browser session, so it runs its own membership check per AGENTS.md.
- [x] 3.3 If email not found: call `postLinearComment` with the "not connected" message including `APP_URL`, then return — `route.ts:161-178`. The not-connected branch matches; a separate `pending` message covers the approval case added by 3.2.
- [x] 3.4 Check if a session with `linearAgentSessionId` already exists (idempotency guard) — if yes, return — `route.ts:182-190`
- [x] 3.5 Fetch user's most recent session to determine default repo; handle case where no prior sessions exist — `route.ts:192-202`; no-prior-session falls through to null repo fields plus a "Which repository should I work in?" prompt (`:214`)
- [x] 3.6 Fetch the Linear issue content using `getLinearIssue` from `lib/linear/issues.ts` — `route.ts:206`, inside try/catch
- [x] 3.7 Build initial context: use existing issue context injection logic from `linear-issue-linking` — `buildIssueContextBlock` (`lib/linear/issues.ts:43-51`) applied at `route.ts:208,216`. The helper physically landed with this change, not with `linear-issue-linking`, which remains unimplemented.
- [x] 3.8 Call `createSessionWithInitialChat()` with `linearIssueId`, `linearAgentSessionId`, repo, and enriched context — `route.ts:218-243`
- [x] 3.9 Log errors at each step; do not let one failure cascade into an unhandled exception — the outer `try/catch` in `after()` (`route.ts:95-109`) guarantees no unhandled rejection escapes. Partial on "each step": 4 of 11 awaits carry a step-specific log (thought activity, paused comment, refusal comment, issue fetch); the other 7 — including `createSessionWithInitialChat` — surface only as the generic "Unhandled error in deferred handler".

## 4. Quality & Verification

- [x] 4.1 Run `bun run ci` — format, lint, typecheck, tests all pass. Verified 2026-08-05: exit 0, 0 lint warnings/errors, all test files pass, migrations in sync.
- [ ] 4.2 Manual test: @mention agent in a Linear issue with a matching user email — verify session created in Open Agents and thought activity appears in Linear
- [ ] 4.3 Manual test: @mention with an email not in our system — verify "not connected" comment appears in Linear, no session created
- [ ] 4.4 Manual test: send same webhook twice — verify only one session is created (idempotency)
- [ ] 4.5 Manual test: invalid signature — verify 401 response and no processing

---

## Validation record (2026-08-05)

Every task above was validated item by item against the source by independent
subagents, one per task group, with the code paths re-checked by hand
afterwards. Checkboxes now reflect verified state; they were previously all
unchecked despite most of the change having shipped.

**Result: 14 of 20 verified complete (70%) — below the bar to archive.**

Group 3 is done in full, and group 1 is done. What blocks the archive is group
2 plus the manual tests:

- **2.2 is a functional break, not a cosmetic deviation.** The route validates
  signatures against an env var while Linear signs with the per-workspace
  secret generated at OAuth time. No automated test catches this, because the
  only test on this route (`agent-runs-paused.test.ts`) mocks `getLinearConfig`
  to return a fixed secret and signs its fixture with that same value.
- **2.3 fails this change's own spec** on the missing-workspace status code.
- **4.2–4.5 have never been run.** They cannot be verified from CI — they need
  a live Linear workspace — and 4.2 and 4.5 are precisely the tests that would
  have caught 2.2. Nobody has driven this end to end.

Test coverage is thin beyond the kill-switch path: no test exercises signature
rejection, the missing-config status code, malformed JSON, the
not-connected/pending branches, the idempotency guard, or repo defaulting.
