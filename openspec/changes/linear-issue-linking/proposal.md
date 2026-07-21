## Why

Once a Linear workspace is connected, users should be able to link a Linear issue to an agent session when creating it manually from the Open Agents UI. The agent receives the issue title and description as context, and the linked issue is visible on the session. This makes it easy for teams already working in Linear to route issues to an AI agent without leaving their workflow.

This is the "pull" half of Linear integration — the app reaches into Linear to read issue data. The "push" (writing activities back to Linear) is covered in `linear-write-back`.

## What Changes

- New `linearIssueId`, `linearIssueUrl`, `linearAgentSessionId` columns on the `sessions` table
- `GET /api/linear/issues?q=` endpoint to search issues by text (used by the UI picker)
- Optional "Link Linear issue" combobox in the New Session form
- Session detail view shows linked issue badge (identifier + title, links to Linear)
- Agent's initial context is enriched with the linked issue's title, description, and identifier when `linearIssueId` is set
- `lib/linear/issues.ts` for issue search and fetch helpers

## Capabilities

### New Capabilities

- `linear-issue-linking`: User can optionally link a Linear issue when creating a session via the UI. The linked issue's content is injected into the agent's initial context. The linked issue is displayed in the session detail view.

### Modified Capabilities

- `sessions`: Sessions gain optional `linearIssueId`, `linearIssueUrl`, and `linearAgentSessionId` fields. No behavior changes for sessions without these fields.

## Impact

- **Database**: Three new nullable columns on `sessions` table; Drizzle migration required
- **API routes**: New `GET /api/linear/issues` search endpoint
- **New lib**: `apps/web/lib/linear/issues.ts`
- **UI**: New session form (issue picker), session detail view (linked issue badge)
- **Agent context**: Session creation logic enriches initial prompt when issue is linked
- **Prerequisite**: `linear-workspace-connection` must be deployed first
- **Downstream**: `linear-agent-webhook` reuses the `linearIssueId` column and context injection logic from this change
