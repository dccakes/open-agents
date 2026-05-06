## Why

With workspace connection and issue linking in place, the next step is making Open Agents a first-class Linear agent. When someone @mentions the agent in a Linear issue or assigns a ticket to it, Linear fires an `AgentSessionEvent` webhook. This change handles that event: it acknowledges immediately, matches the triggering user by email, creates an agent session, and posts a thought activity back to Linear within the required 10-second window. The result: a team member can delegate work to the agent directly from Linear and watch a session spin up automatically.

## What Changes

- `POST /api/linear/webhook` — validates signature, returns 200 immediately, defers all work via `after()`
- `after()` handler: posts thought activity to Linear, matches email → user, creates session with `linearIssueId` and `linearAgentSessionId`, provisions sandbox
- Email-not-found case: posts a comment in Linear directing the unrecognized user to connect
- `lib/linear/activities.ts` — helpers for posting thought activities and comments to Linear's agent session API
- Reuses the issue context injection built in `linear-issue-linking`

## Capabilities

### New Capabilities

- `linear-agent-webhook`: Handles `AgentSessionEvent` from Linear. Validates webhook signature, acknowledges within 10 seconds, matches Linear user email to Open Agents user, creates a session linked to the triggering issue, and begins agent execution. Posts a "not found" comment if the user's email doesn't exist in Open Agents.

### Modified Capabilities

## Impact

- **API routes**: New `POST /api/linear/webhook`
- **New lib**: `apps/web/lib/linear/activities.ts`
- **Session creation**: Webhook handler reuses `createSessionWithInitialChat()` and issue context injection
- **Prerequisites**: `linear-workspace-connection` (for token + webhookSecret) and `linear-issue-linking` (for `linearIssueId` columns and context injection) must be deployed first
- **Downstream**: `linear-write-back` adds activity posting at later lifecycle events; the webhook handler itself only needs to post the initial thought
