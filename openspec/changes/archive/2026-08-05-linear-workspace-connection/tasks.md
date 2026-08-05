## 1. Database

- [x] 1.1 Add `linearWorkspaces` table to `apps/web/lib/db/schema.ts` (id, workspaceId, workspaceName, accessToken, webhookSecret, webhookId, installedByUserId, createdAt, updatedAt)
- [x] 1.2 Generate Drizzle migration: `bun run --cwd apps/web db:generate`
- [x] 1.3 Create `apps/web/lib/db/linear-workspaces.ts` with `upsertLinearWorkspace`, `getLinearWorkspace`, `deleteLinearWorkspace` helpers

## 2. Linear Client Library

- [x] 2.1 Create `apps/web/lib/linear/client.ts` — authenticated GraphQL client factory using workspace token
- [x] 2.2 Create `apps/web/lib/linear/token.ts` — `getLinearWorkspaceToken()` returns decrypted token or null
- [x] 2.3 Add `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` to `.env.local` and Vercel environment variables (document in README or env example)

## 3. OAuth Flow

- [x] 3.1 Create `apps/web/app/api/linear/connect/route.ts` — GET handler that builds Linear OAuth URL with `actor=app`, correct scopes, and CSRF state param, then redirects
- [x] 3.2 Create `apps/web/app/api/linear/callback/route.ts` — exchanges `code` for token, fetches workspace info via GraphQL (`viewer { organization { id name } }`), calls webhook registration, upserts `linearWorkspaces` record, redirects to settings
- [x] 3.3 Implement `registerLinearWebhook(token)` helper in `apps/web/lib/linear/webhook.ts` — calls Linear `webhookCreate` mutation with `APP_URL/api/linear/webhook` URL and `AgentSessionEvent` resource type, returns `{ webhookId, webhookSecret }`
- [x] 3.4 Implement `deregisterLinearWebhook(token, webhookId)` helper — calls Linear `webhookDelete` mutation, swallows errors gracefully

## 4. Connection Status & Disconnect APIs

- [x] 4.1 Create `apps/web/app/api/linear/connection-status/route.ts` — returns `{ connected, workspaceName?, reason? }`, validates token liveness with a lightweight Linear API call
- [x] 4.2 Create `apps/web/app/api/linear/disconnect/route.ts` — deletes `linearWorkspaces` record and calls `deregisterLinearWebhook`

## 5. Settings UI

- [x] 5.1 Create `apps/web/app/settings/connections/linear-connection-card.tsx` — shows connected/disconnected state with workspace name, "Connect Linear" or "Disconnect" button, consistent with GitHub/Vercel card styling
- [x] 5.2 Wire Linear connection card into the Connections settings page alongside existing GitHub and Vercel cards
- [x] 5.3 Fetch connection status client-side using `/api/linear/connection-status`

## 6. Quality & Verification

- [x] 6.1 Run `bun run ci` — format, lint, typecheck, tests all pass
- [ ] 6.2 Manual test: connect a Linear workspace, verify `linearWorkspaces` record created and webhook appears in Linear app settings
- [ ] 6.3 Manual test: disconnect, verify record deleted and webhook removed from Linear
- [ ] 6.4 Manual test: connection status card shows correct state before and after connect/disconnect
