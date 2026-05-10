## Context

The codebase has several lifecycle event points where we can hook write-back:

1. **Session creation** (`apps/web/app/api/sessions/route.ts`) — already the place where initial context is built. The webhook handler posts the *thought* activity before session creation (in `linear-agent-webhook`); the session creation route should post a "session is live" activity after creation.

2. **PR webhook** (`apps/web/app/api/github/webhook/route.ts`) — already handles `pull_request` events and updates session PR status. This is the right place to post a "PR created" activity to Linear.

3. **Session archival/completion** — sessions are archived when work is done or abandoned. The PR merge event also triggers archival. This is where "done" or "complete" activities belong.

4. **Error/block events** — currently not a formal lifecycle event. For this change, we post to Linear when the session enters an error state or when the agent surfaces a block in its output.

`lib/linear/activities.ts` (built in `linear-agent-webhook`) already has `postLinearThoughtActivity` and `postLinearComment`. This change adds an activity post variant for agent session activities (not thought activities — those are shown differently in Linear's UI).

## Goals / Non-Goals

**Goals:**
- Post Linear activities at: session started, PR created, session blocked/errored, session completed
- Each activity includes a "View full session →" link to `{APP_URL}/sessions/{sessionId}`
- Error activities include a brief description of the error
- All write-back is fire-and-forget (no retries, no blocking the primary flow)
- Only sessions with `linearAgentSessionId` get write-back

**Non-Goals:**
- Real-time streaming of agent messages to Linear (too noisy, high volume)
- Posting every tool call or intermediate step
- Retrying failed activity posts
- Syncing Linear issue status (e.g., marking issue as in-progress/done in Linear)

## Decisions

### Central `session-sync.ts` module, not ad-hoc calls

**Decision**: Create `lib/linear/session-sync.ts` with typed functions for each event type: `onSessionStarted`, `onPullRequestCreated`, `onSessionBlocked`, `onSessionCompleted`. Each function checks for `linearAgentSessionId`, gets the token, and calls `postLinearActivity`.

**Rationale**: Keeps write-back logic in one place. Each call site just calls the appropriate `sessionSync.*` function without caring about Linear details. Easy to expand or disable.

**Alternative considered**: Inline the Linear API calls at each event point. Rejected — scatters Linear logic across multiple files and makes it harder to test or disable.

### Fire-and-forget, no retries

**Decision**: All Linear activity posts are fire-and-forget. Errors are logged but do not affect the primary operation.

**Rationale**: Linear write-back is a best-effort feature. A failed activity post should never block a PR from being recorded, a session from being archived, etc. The full session trace is always available in our UI — Linear activities are supplementary.

### Activity format

Each activity follows this template:

```
{emoji} {headline}

{detail (optional for error/block cases)}

[View full session →]({APP_URL}/sessions/{sessionId})
```

Event-specific content:
- **Session started**: `🚀 Session started` (no detail needed — thought activity from webhook handler already covered the announcement)
- **PR created**: `🔀 Created PR #{number}: {title}` + PR URL
- **Session blocked**: `🚧 Agent needs input: {brief reason if available}`
- **Session completed**: `✅ Session complete` (PR merged or session archived successfully)
- **Session errored**: `❌ Session failed: {error summary}`

### Linear API: agent activity vs. comment

**Decision**: Use Linear's agent session activity API (not comments) for write-back. Comments are for human-readable messages; agent activities are for agent progress reporting and show up differently in Linear's UI.

**Rationale**: `lib/linear/activities.ts` already has `postLinearThoughtActivity` for the thought type. Extend it with `postLinearAgentActivity` for progress activities. If Linear's agent session API doesn't distinguish activity types, use comments as fallback.

### Hook points

| Event | File to modify |
|-------|---------------|
| Session started | `apps/web/app/api/sessions/route.ts` — after `createSessionWithInitialChat()` succeeds |
| PR created | `apps/web/app/api/github/webhook/route.ts` — in `handlePullRequestWebhook`, when PR is opened/ready |
| Session blocked | Agent runner output processing — when agent signals it needs input |
| Session completed | Session archival logic — when session transitions to archived/completed state |
| Session errored | Session error handling — when session transitions to error state |

## Risks / Trade-offs

- **Linear API rate limits** → If many sessions complete simultaneously, we could hit rate limits. Mitigation: fire-and-forget with error logging; no user impact.
- **Token revoked between write-back calls** → Token retrieved at event time. If revoked, the call fails silently (logged). No impact on primary operation.
- **Activity format changes** → Linear may update its agent session API. Mitigation: all format logic is in `session-sync.ts`, easy to update in one place.
- **Session completed event ambiguity** → "Completed" could mean PR merged, session manually archived, or session auto-archived after inactivity. For now, post "complete" for PR-merged and agent-finished states; skip for inactivity archival.

## Open Questions

- Where exactly does the agent signal "blocked/needs input"? (Need to identify the right hook point in the agent runner during implementation)
- Should the "session started" activity be skipped if the session was created via webhook (the thought activity already announced it)? (Recommendation: yes, skip for webhook-triggered sessions to avoid duplicate messages)
