## Context

The GitHub webhook handler (`/api/github/webhook/route.ts`) is the established pattern: validate HMAC-SHA256 signature, parse event type, return 200, then do deferred work with `next/server.after()`. The same pattern works here.

Linear's `AgentSessionEvent` webhook carries: the Linear user who triggered it (including email), the issue being worked on, and a Linear-side `agentSessionId`. Linear requires the agent to post a "thought activity" within 10 seconds or the session shows as unresponsive.

The issue context injection (fetching issue title + description) is already built in `linear-issue-linking`. The webhook handler reuses that work.

## Goals / Non-Goals

**Goals:**
- Validate Linear webhook signature using stored `webhookSecret`
- Return HTTP 200 immediately (before any async work)
- Post Linear thought activity within 10 seconds of webhook receipt
- Match triggering user email → Open Agents user
- Create an agent session linked to the Linear issue + agent session ID
- Post "not connected" comment in Linear when email not found

**Non-Goals:**
- Writing back subsequent activities during agent execution (that's `linear-write-back`)
- Handling Linear webhooks other than `AgentSessionEvent`
- Retry logic for failed session creation (out of scope — Linear will retry the webhook if we fail to return 200, but we always return 200 immediately)

## Decisions

### Validate signature then return 200, defer everything with `after()`

**Decision**: The webhook route validates the HMAC-SHA256 signature synchronously, returns 200, then does all work (thought activity post, user lookup, session creation) inside `next/server.after()`.

**Rationale**: Same pattern as GitHub webhook handler. Linear's 10-second window for the thought activity is generous enough for `after()` — the actual response is immediate, and posting the thought is the first thing the deferred handler does. If the deferred work fails entirely, Linear sees the 200 (so it won't retry) but we log the error.

**Alternative considered**: Doing the thought activity post before returning 200. Rejected — Linear's POST timeout is shorter than the 10-second thought window; we'd risk timing out the webhook response while waiting on Linear's API.

### Post thought activity before provisioning sandbox

**Decision**: The deferred handler posts the Linear thought activity ("Starting on this, spinning up a session...") as its very first action, before creating the session or provisioning the sandbox.

**Rationale**: Guarantees the 10-second requirement is met even if sandbox provisioning takes longer. The thought activity is a lightweight API call that should complete in < 1 second.

### Email matching against `users` table

**Decision**: Match the `actor.email` from the webhook payload against the `users.email` column.

**Rationale**: Linear includes the triggering user's email in the `AgentSessionEvent` payload. The `users` table stores email. Direct lookup, no additional join needed.

**No-match behavior**: Post a Linear comment on the issue (not a thought activity — a comment is visible to all): "Hey @{linearUsername}, `{email}` isn't connected to Open Agents yet. Sign in at `{APP_URL}` to run sessions from Linear." Then stop — no session created.

### Session created with `linearIssueId` and `linearAgentSessionId`

**Decision**: The webhook handler creates the session with both fields populated. `linearIssueId` comes from the webhook payload's issue ID. `linearAgentSessionId` comes from the webhook's `agentSession.id`.

**Rationale**: `linearAgentSessionId` is needed by `linear-write-back` to post subsequent activities to the correct Linear agent session. Capturing it at creation time means `linear-write-back` just reads from the session record.

### Repo selection: use user's default or require prior configuration

**Decision**: Use the user's most recently used repository (from their session history) as the default. If the user has no prior sessions, create the session without a repo and let the agent ask.

**Rationale**: Linear issues don't encode which repo to use. Per-team or per-project repo mapping is a future enhancement. For now, defaulting to last-used repo covers the common case (one-repo teams). The agent can handle the ambiguous case by asking in its first message.

**Future**: Could be enhanced with Linear team → repo mapping in user preferences.

## Risks / Trade-offs

- **Deferred work failure after 200** → If `after()` fails (DB error, Linear API down), Linear won't retry (it got 200). We log the error. Mitigation: robust error logging; consider a queue for retries in a future change.
- **Thought activity timing** → `after()` runs after the response is sent but is not guaranteed to complete within any time window on serverless. On Vercel, Fluid Compute keeps the instance warm, so this is fine in practice. On edge/cold starts it could miss the 10s window. Mitigation: document requirement for Fluid Compute (already the default on Vercel).
- **Duplicate webhooks** → Linear may retry the webhook on transient failures. If we get the same event twice, we'd create two sessions. Mitigation: idempotency check on `linearAgentSessionId` — if a session with that ID already exists, skip creation.
- **User email mismatch** → User's Linear email differs from their Open Agents email. Not handled in this change. Mitigation: the "not connected" comment tells them to sign up; they can link manually.

## Open Questions

- What repo should be used when the user has no prior sessions? (Recommendation: create session with no repo; agent's first message asks which repo to work in)
- Should the thought activity text be configurable? (Recommendation: no — hardcode a sensible default for now)
