## 1. Database

- [ ] 1.1 Add `linearIssueId` (text, nullable), `linearIssueUrl` (text, nullable), `linearAgentSessionId` (text, nullable) columns to `sessions` table in `apps/web/lib/db/schema.ts`
- [ ] 1.2 Generate Drizzle migration: `bun run --cwd apps/web db:generate`

## 2. Linear Issues Library

- [ ] 2.1 Create `apps/web/lib/linear/issues.ts` with `searchLinearIssues(token, query)` — GraphQL search returning `{ id, identifier, title, url }[]`
- [ ] 2.2 Add `getLinearIssue(token, issueId)` to `apps/web/lib/linear/issues.ts` — fetches full issue including description

## 3. Issues Search API

- [ ] 3.1 Create `apps/web/app/api/linear/issues/route.ts` — GET handler, retrieves workspace token, calls `searchLinearIssues`, returns JSON array; returns 401 if no workspace connected

## 4. Agent Context Injection

- [ ] 4.1 In `apps/web/app/api/sessions/route.ts`, fetch the Linear issue when `linearIssueId` is provided in the request body
- [ ] 4.2 Build structured context block from issue data (identifier, title, description — truncate description at 2000 chars with note)
- [ ] 4.3 Append the context block to the initial user message before calling `createSessionWithInitialChat()`
- [ ] 4.4 Handle issue fetch failure gracefully — log error, proceed without issue context, do not fail session creation

## 5. New Session Form UI

- [ ] 5.1 Create `apps/web/app/sessions/new/linear-issue-picker.tsx` — debounced combobox that queries `/api/linear/issues?q=`, shows identifier + title in results
- [ ] 5.2 Integrate `LinearIssuePicker` into the New Session form as an optional field
- [ ] 5.3 Conditionally render the picker only when `/api/linear/connection-status` returns `connected: true`
- [ ] 5.4 Pass selected issue's `id` and `url` in the session creation POST body

## 6. Session Detail View

- [ ] 6.1 Create `apps/web/app/sessions/[id]/linear-issue-badge.tsx` — displays issue identifier + title as a clickable badge linking to Linear
- [ ] 6.2 Render `LinearIssueBadge` in the session detail view when session has `linearIssueId`

## 7. Quality & Verification

- [ ] 7.1 Run `bun run ci` — format, lint, typecheck, tests all pass
- [ ] 7.2 Manual test: create a session with a linked Linear issue, verify issue context appears in the agent's initial prompt (check DB chat message)
- [ ] 7.3 Manual test: session detail view shows the linked issue badge with correct title and link
- [ ] 7.4 Manual test: create a session without linking an issue — behavior unchanged
- [ ] 7.5 Manual test: issue picker not visible when Linear workspace is not connected
