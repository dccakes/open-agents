## 1. Linear Activities Library

- [ ] 1.1 Create `apps/web/lib/linear/activities.ts` with `postLinearThoughtActivity(token, agentSessionId, text)` — POSTs to Linear agent session API
- [ ] 1.2 Add `postLinearComment(token, issueId, body)` to `apps/web/lib/linear/activities.ts` — posts a comment on a Linear issue (used for "not connected" message)

## 2. Webhook Handler

- [ ] 2.1 Create `apps/web/app/api/linear/webhook/route.ts` — POST handler
- [ ] 2.2 Implement HMAC-SHA256 signature validation using `webhookSecret` from `linearWorkspaces` (timing-safe comparison, same pattern as GitHub webhook)
- [ ] 2.3 Return HTTP 200 immediately after signature validation passes; return 401 for invalid signature or missing workspace
- [ ] 2.4 Parse webhook payload with Zod schema: extract `agentSession.id`, `issue.id`, `issue.url`, `actor.email`, `actor.name`

## 3. Deferred Handler (`after()`)

- [ ] 3.1 In the `after()` callback, immediately call `postLinearThoughtActivity` with "Starting on this, spinning up a session..."
- [ ] 3.2 Look up `actor.email` in `users` table
- [ ] 3.3 If email not found: call `postLinearComment` with the "not connected" message including `APP_URL`, then return
- [ ] 3.4 Check if a session with `linearAgentSessionId` already exists (idempotency guard) — if yes, return
- [ ] 3.5 Fetch user's most recent session to determine default repo; handle case where no prior sessions exist
- [ ] 3.6 Fetch the Linear issue content using `getLinearIssue` from `lib/linear/issues.ts`
- [ ] 3.7 Build initial context: use existing issue context injection logic from `linear-issue-linking`
- [ ] 3.8 Call `createSessionWithInitialChat()` with `linearIssueId`, `linearAgentSessionId`, repo, and enriched context
- [ ] 3.9 Log errors at each step; do not let one failure cascade into an unhandled exception

## 4. Quality & Verification

- [ ] 4.1 Run `bun run ci` — format, lint, typecheck, tests all pass
- [ ] 4.2 Manual test: @mention agent in a Linear issue with a matching user email — verify session created in Open Agents and thought activity appears in Linear
- [ ] 4.3 Manual test: @mention with an email not in our system — verify "not connected" comment appears in Linear, no session created
- [ ] 4.4 Manual test: send same webhook twice — verify only one session is created (idempotency)
- [ ] 4.5 Manual test: invalid signature — verify 401 response and no processing
