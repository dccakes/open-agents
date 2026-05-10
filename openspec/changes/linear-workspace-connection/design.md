## Context

The app already has two OAuth integrations: GitHub (both standard user OAuth and GitHub App installations) and Vercel. Both user-level tokens go through better-auth's social provider flow (stored in the `accounts` table). GitHub App installations go through a custom OAuth callback (`/api/github/app/callback`) and are stored in the dedicated `githubInstallations` table.

Linear's `actor=app` OAuth is workspace-level — the resulting token represents an app installation in a workspace, not a user's identity. This is the same pattern as GitHub App installations. It should NOT go through better-auth's social login flow.

Current state: no Linear integration exists. `apps/web/app/settings/connections/` exists but only has stub components.

## Goals / Non-Goals

**Goals:**
- Workspace admins can connect a Linear workspace via OAuth (actor=app)
- Token + webhook config stored securely in `linearWorkspaces` table
- Webhook auto-registered with Linear API during callback — no manual setup
- Connection status queryable by the web app
- Clean disconnect (token removed, webhook deregistered)
- Foundation that `linear-issue-linking`, `linear-agent-webhook`, and `linear-write-back` build on

**Non-Goals:**
- Per-user Linear OAuth (not needed — workspace token covers all operations)
- Supporting multiple Linear workspaces per deployment (one workspace, one installation)
- Any agent behavior, issue reading, or session creation (that's downstream changes)

## Decisions

### Custom OAuth handler, not better-auth social provider

**Decision**: Implement a custom `/api/linear/callback` route, not a better-auth social provider.

**Rationale**: `actor=app` is a workspace installation, not user authentication. better-auth social providers are designed for user identity — they store tokens per-user in the `accounts` table and tie them to a session. A workspace installation token is shared across all users and has no associated user session at time of use.

**Alternative considered**: Adding Linear as a better-auth social provider anyway and repurposing the accounts table. Rejected because it conflates user identity with app installations, making token retrieval and permission model confusing.

**Precedent**: This follows the same pattern as the GitHub App callback (`/api/github/app/callback`), which is also a custom handler outside better-auth.

### Dedicated `linearWorkspaces` table (not `accounts`)

**Decision**: Store workspace installation in its own `linearWorkspaces` table.

**Rationale**: The `accounts` table is keyed by `(userId, providerId)` — it's per-user. A workspace installation is per-deployment, not per-user. The `githubInstallations` table is the precedent for this pattern.

**Token encryption**: Use the same encryption approach as better-auth uses for `accounts.accessToken` (the project already has this infrastructure via better-auth's Drizzle adapter).

### Programmatic webhook registration in OAuth callback

**Decision**: After exchanging the OAuth code for a token, immediately call Linear's `webhookCreate` GraphQL mutation to register the webhook. Generate and store a random `webhookSecret` at this point.

**Rationale**: Eliminates manual setup steps. The admin completes OAuth and the integration is fully operational. Deregistration on disconnect keeps Linear's webhook list clean.

**Webhook URL**: `{APP_URL}/api/linear/webhook`. Must be set via `NEXT_PUBLIC_APP_URL` env var (already exists in the project for similar uses).

### One workspace per deployment

**Decision**: Only one Linear workspace installation supported. Attempting to install again replaces the existing record (upsert by `workspaceId`).

**Rationale**: The app serves a single team. Multiple workspace support adds complexity with no current use case. Can be revisited if needed.

### GraphQL client: raw fetch, not SDK

**Decision**: Use direct `fetch` calls to Linear's GraphQL endpoint (`https://api.linear.app/graphql`), not the `@linear/sdk` npm package.

**Rationale**: The SDK adds ~200KB of dependencies for operations that are trivially expressible as typed fetch calls with Zod response validation. The project already uses this pattern (Vercel API calls are raw fetch). If complexity grows, SDK adoption can be revisited in a future change.

## Risks / Trade-offs

- **Token expiry** → Linear workspace tokens may expire or be revoked. The connection status check should validate the token against the Linear API (not just check if a record exists), so stale connections surface early. Mitigation: connection status endpoint makes a lightweight API call to verify.
- **Webhook URL must be public** → OAuth callback and webhook registration require a publicly accessible URL. Local development requires a tunnel (ngrok/cloudflared). Document in README. No mitigation needed for production.
- **Webhook deregistration on disconnect** → If the Linear API call to delete the webhook fails during disconnect, we still remove our local record. The orphaned webhook in Linear will just 404 on future events. Low impact.
- **Single workspace constraint** → If a team has multiple Linear workspaces, they can't connect both. Accepted as a known limitation of this change.

## Migration Plan

1. Add `linearWorkspaces` table via Drizzle migration (`bun run --cwd apps/web db:generate`)
2. Deploy — migration runs automatically on next Vercel deploy
3. Register Linear OAuth app in Linear's developer settings, configure redirect URI to `{APP_URL}/api/linear/callback`
4. Add `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` to Vercel environment variables
5. Admin connects workspace via Settings → Connections
6. Rollback: remove `linearWorkspaces` table migration, remove env vars, remove routes

## Open Questions

- Does Linear's `actor=app` token expire, and if so, does it provide a refresh token? (Need to verify during implementation — if it does, add `refreshToken` and `expiresAt` columns)
- Should the "Connect Linear" button be admin-only or available to all users? (Recommendation: any authenticated user can connect, same as Vercel/GitHub)
