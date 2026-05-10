## Context

Sessions are created via `POST /api/sessions` which calls `createSessionWithInitialChat()`. The session record stores repo info, sandbox config, and other metadata. Currently there's no concept of linked external issues.

The New Session form already collects repo, branch, and description. Adding an issue picker is additive — it's an optional field that doesn't change existing session creation for users who don't use Linear.

Agent context injection happens at session/chat creation time — the initial chat message is constructed and stored, then picked up by the agent runner.

## Goals / Non-Goals

**Goals:**
- Optional Linear issue picker in the New Session form
- Issue search via Linear GraphQL (title, identifier, description)
- `linearIssueId`, `linearIssueUrl`, `linearAgentSessionId` stored on session record
- Issue content injected into agent's initial context when session has a linked issue
- Linked issue displayed in session detail view

**Non-Goals:**
- Writing back to Linear (that's `linear-write-back`)
- Webhook-triggered sessions (that's `linear-agent-webhook`)
- Syncing issue status changes from Linear in real time
- Showing all Linear issues in a dedicated view

## Decisions

### Issue search via GraphQL, not cached/synced

**Decision**: Search Linear issues on-demand via `GET /api/linear/issues?q=` using the workspace token. No local cache or sync.

**Rationale**: The search box is used infrequently (only at session creation time). Linear's GraphQL search is fast enough for interactive use. Caching would add complexity and staleness risk. If Linear is unavailable, the picker is disabled but session creation without an issue still works.

**Alternative considered**: Background sync of issues to a local `linearIssues` table. Rejected — adds a sync job, storage, and staleness problems for a feature used occasionally.

### Issue content injected into initial chat message

**Decision**: When a session has `linearIssueId`, the system appends a structured block to the agent's initial context at session creation time:

```
## Linked Linear Issue
**[ENG-123] Issue title**
Issue description text...
```

**Rationale**: The agent gets full context without needing to make Linear API calls during its run. This is consistent with how repo/branch context is provided — baked in at session creation, not fetched lazily.

**Where**: `apps/web/app/api/sessions/route.ts` fetches the issue (using `lib/linear/issues.ts`) before calling `createSessionWithInitialChat()`, then prepends/appends the issue block to the initial user message.

### `linearAgentSessionId` column included now, used later

**Decision**: Add `linearAgentSessionId` to the `sessions` table in this migration, even though it's not populated by this change.

**Rationale**: `linear-agent-webhook` (the next change) also needs this column. Adding it here keeps migrations clean — downstream change doesn't need its own schema migration for this field. The column is nullable so it has no impact on existing behavior.

### No repo auto-detection from Linear issue

**Decision**: When a user picks a Linear issue, the form does NOT attempt to auto-fill the repo field.

**Rationale**: Linear issues don't reliably encode which repo they belong to. Auto-detection would require heuristics that break in edge cases. The user picks the issue, then picks the repo — two explicit choices. Can be improved later via Linear's project → repo mapping if teams configure it.

## Risks / Trade-offs

- **Linear unavailable during session creation** → If the issue fetch fails at session creation time, fail gracefully: create the session without the issue context and show a warning. Don't block session creation.
- **Issue picker when no workspace connected** → Hide or disable the picker. No error, just not shown.
- **Long issue descriptions** → Truncate at a reasonable limit (e.g., 2000 chars) before injecting into context to avoid token overload. Include a note if truncated.
- **Search latency** → Linear search can be 200–400ms. The combobox should debounce (~300ms) and show a loading state.

## Open Questions

- Should the issue picker be visible when no Linear workspace is connected, or hidden entirely? (Recommendation: hidden — no point surfacing it without a connection)
- Should the linked issue show in the session list view (cards) or only in the session detail? (Recommendation: detail only for now, keeps list view clean)
