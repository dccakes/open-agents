## 1. Session Sync Library

- [ ] 1.1 Add `postLinearAgentActivity(token, agentSessionId, body)` to `apps/web/lib/linear/activities.ts` — posts a progress activity (distinct from thought activity) to Linear's agent session API
- [ ] 1.2 Create `apps/web/lib/linear/session-sync.ts` with the following exported functions (all fire-and-forget, swallow errors, log failures):
  - `onSessionStarted(session)` — skips if no `linearAgentSessionId` or if session was webhook-triggered
  - `onPullRequestCreated(session, pr: { number, title, url })` — posts PR activity
  - `onSessionBlocked(session, reason?: string)` — posts blocked activity
  - `onSessionCompleted(session)` — posts completion activity
  - `onSessionErrored(session, errorSummary: string)` — posts error activity
- [ ] 1.3 Each function in `session-sync.ts` SHALL: check for `linearAgentSessionId`, call `getLinearWorkspaceToken()`, call `postLinearAgentActivity`, catch and log any errors without rethrowing

## 2. Hook: Session Started

- [ ] 2.1 In `apps/web/app/api/sessions/route.ts`, call `sessionSync.onSessionStarted(session)` after `createSessionWithInitialChat()` succeeds
- [ ] 2.2 Determine if the session was webhook-triggered (check presence of `linearAgentSessionId` set by webhook handler vs. UI) and skip if so — document the detection logic clearly

## 3. Hook: PR Created

- [ ] 3.1 In `apps/web/app/api/github/webhook/route.ts`, inside `handlePullRequestWebhook`, call `sessionSync.onPullRequestCreated(session, { number, title, url })` when a PR is opened/ready for review
- [ ] 3.2 Only call if the session has a `linearAgentSessionId` (guard inside `onPullRequestCreated` handles this, but explicit check is fine too)

## 4. Hook: Session Blocked

- [ ] 4.1 Identify where in the agent runner or chat processing pipeline the agent signals it needs user input
- [ ] 4.2 Call `sessionSync.onSessionBlocked(session)` at that point

## 5. Hook: Session Completed and Errored

- [ ] 5.1 Identify the session archival/completion code path (where `lifecycleState` transitions to completed/archived)
- [ ] 5.2 Call `sessionSync.onSessionCompleted(session)` for successful completions (PR merged or agent-finished); skip for inactivity archival
- [ ] 5.3 Call `sessionSync.onSessionErrored(session, errorSummary)` when session enters error state

## 6. Quality & Verification

- [ ] 6.1 Run `bun run ci` — format, lint, typecheck, tests all pass
- [ ] 6.2 Manual test (webhook-triggered session): @mention agent → verify thought activity appears, then PR → verify PR activity in Linear, then completion → verify done activity in Linear
- [ ] 6.3 Manual test (UI-triggered session with linked issue): create session → verify "session started" activity in Linear, then PR → verify PR activity
- [ ] 6.4 Manual test: verify "View full session →" link in each activity correctly navigates to the session
- [ ] 6.5 Manual test: disconnect Linear workspace, then trigger a lifecycle event — verify no errors thrown and primary operation completes normally
