## ADDED Requirements

### Requirement: Admin can initiate Linear workspace OAuth connection
An authenticated user SHALL be able to initiate a Linear workspace OAuth connection from the Settings → Connections page. The connection flow SHALL use `actor=app` in the authorization URL and request scopes `read,write,app:mentionable,app:assignable`.

#### Scenario: User initiates connection
- **WHEN** an authenticated user clicks "Connect Linear" on the Connections settings page
- **THEN** the browser is redirected to Linear's OAuth authorization URL with `actor=app` param and the correct scopes

#### Scenario: OAuth callback completes successfully
- **WHEN** Linear redirects to `/api/linear/callback` with a valid `code` param
- **THEN** the system exchanges the code for a workspace access token, fetches the workspace ID and name via GraphQL, registers a webhook for `AgentSessionEvent`, and stores the result in `linearWorkspaces`

#### Scenario: OAuth callback with invalid code
- **WHEN** Linear redirects to `/api/linear/callback` with an invalid or expired `code`
- **THEN** the system returns an error response and does NOT create a `linearWorkspaces` record

### Requirement: Webhook is registered automatically during OAuth callback
After a successful OAuth token exchange, the system SHALL programmatically register a Linear webhook for `AgentSessionEvent` resource type. A unique `webhookSecret` SHALL be generated and stored alongside the webhook ID.

#### Scenario: Webhook registration succeeds
- **WHEN** the OAuth callback successfully exchanges a code for a token
- **THEN** a webhook is registered with Linear pointing to `{APP_URL}/api/linear/webhook` and the `webhookId` and `webhookSecret` are stored in `linearWorkspaces`

#### Scenario: Webhook registration fails
- **WHEN** the webhook registration call to Linear fails after successful token exchange
- **THEN** the `linearWorkspaces` record is NOT persisted and an error is surfaced to the user

### Requirement: Connection status is queryable
The system SHALL expose a `/api/linear/connection-status` endpoint that returns whether a Linear workspace is connected and validates the token is still active.

#### Scenario: Workspace is connected and token is valid
- **WHEN** a `GET /api/linear/connection-status` request is made and a `linearWorkspaces` record exists with a valid token
- **THEN** the response includes `{ connected: true, workspaceName: string }`

#### Scenario: No workspace connected
- **WHEN** a `GET /api/linear/connection-status` request is made and no `linearWorkspaces` record exists
- **THEN** the response includes `{ connected: false }`

#### Scenario: Workspace record exists but token is revoked
- **WHEN** a `GET /api/linear/connection-status` request is made and the token fails Linear API validation
- **THEN** the response includes `{ connected: false, reason: "token_invalid" }`

### Requirement: Admin can disconnect Linear workspace
The system SHALL allow an authenticated user to disconnect the Linear workspace. Disconnecting SHALL remove the local `linearWorkspaces` record and attempt to deregister the webhook from Linear.

#### Scenario: Successful disconnect
- **WHEN** a user triggers disconnect from the Connections settings page
- **THEN** the `linearWorkspaces` record is deleted and the webhook is deregistered from Linear via API

#### Scenario: Webhook deregistration fails during disconnect
- **WHEN** the webhook deregistration API call to Linear fails during disconnect
- **THEN** the local `linearWorkspaces` record is still deleted and the user sees a success state (orphaned webhook is non-critical)

### Requirement: Settings Connections page shows Linear connection card
The Settings → Connections page SHALL display a Linear connection card consistent with the existing GitHub and Vercel connection cards.

#### Scenario: Linear not connected
- **WHEN** a user views the Connections page and no Linear workspace is connected
- **THEN** the Linear card shows "Not connected" state with a "Connect Linear" button

#### Scenario: Linear connected
- **WHEN** a user views the Connections page and a Linear workspace is connected
- **THEN** the Linear card shows the connected workspace name and a "Disconnect" button

### Requirement: Linear GraphQL client and token access helpers exist
The system SHALL provide `lib/linear/client.ts` (authenticated GraphQL client factory) and `lib/linear/token.ts` (workspace token retrieval) for use by downstream features.

#### Scenario: Token retrieval succeeds
- **WHEN** `getLinearWorkspaceToken()` is called and a `linearWorkspaces` record exists
- **THEN** it returns the decrypted access token

#### Scenario: Token retrieval with no connected workspace
- **WHEN** `getLinearWorkspaceToken()` is called and no `linearWorkspaces` record exists
- **THEN** it returns `null`
