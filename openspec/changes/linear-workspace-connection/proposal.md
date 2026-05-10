## Why

Open Agents needs a foundation for Linear integration — a workspace-level OAuth connection that grants the app permission to read issues, post as an agent, and be assigned tickets. Without this infrastructure, none of the Linear features (issue linking, webhook-triggered sessions, write-back) can be built.

## What Changes

- New `linearWorkspaces` database table to store workspace installation tokens and webhook configuration
- Linear OAuth flow using `actor=app` param, granting workspace-level (not user-level) access
- Programmatic webhook registration after OAuth — no manual Linear dashboard setup required
- Settings → Connections UI card for connecting/disconnecting a Linear workspace
- Connection status API endpoint
- Linear GraphQL client library and token access helpers

## Capabilities

### New Capabilities

- `linear-workspace-connection`: Workspace-level OAuth installation flow using `actor=app`, token storage, webhook auto-registration, connection status, and disconnect. Scopes: `read,write,app:mentionable,app:assignable`.

### Modified Capabilities

## Impact

- **Database**: New `linearWorkspaces` table; Drizzle migration required
- **API routes**: `/api/linear/callback`, `/api/linear/connection-status`, `/api/linear/disconnect`
- **New libs**: `lib/linear/client.ts`, `lib/linear/token.ts`, `lib/db/linear-workspaces.ts`
- **UI**: `apps/web/app/settings/connections/` — new Linear connection card alongside GitHub/Vercel
- **Environment variables**: `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` required
- **Dependencies**: Linear SDK or direct GraphQL fetch (no new heavy deps required)
- **Downstream changes**: `linear-issue-linking`, `linear-agent-webhook`, `linear-write-back` all depend on this
