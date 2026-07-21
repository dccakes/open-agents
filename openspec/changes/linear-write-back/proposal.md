## Why

Sessions can now be linked to Linear issues (via UI or webhook). But without write-back, the Linear issue stays silent while the agent works — the team has no visibility into progress without opening Open Agents. This change closes the loop: key session lifecycle events (started, PR created, blocked, done) are mirrored as Linear agent activities. The Linear issue becomes a live progress feed, with a link to the full session for anyone who wants the detail.

## What Changes

- `lib/linear/session-sync.ts` — maps session lifecycle events to Linear activity posts
- Hooks into existing lifecycle points: session creation, PR webhook handler, session archival, error/block events
- Each Linear activity includes a "View full session →" link to our session UI
- For debug/error scenarios: slightly richer activity text with error context
- Only sessions with `linearAgentSessionId` receive write-back (no-ops for non-Linear sessions)

## Capabilities

### New Capabilities

- `linear-write-back`: Session lifecycle events are mirrored as Linear agent activities for sessions linked to a Linear agent session. High-signal events only: session started, PR created, session blocked or errored, session completed. Each activity links to the full Open Agents session.

### Modified Capabilities

## Impact

- **New lib**: `apps/web/lib/linear/session-sync.ts`
- **Modified files**: PR webhook handler, session creation path, session archival/completion logic
- **Reuses**: `lib/linear/activities.ts` (from `linear-agent-webhook`) and `lib/linear/token.ts`
- **Prerequisites**: All three prior Linear changes must be deployed
- **No new API routes or DB changes**: this change is purely additive hooks into existing event points
