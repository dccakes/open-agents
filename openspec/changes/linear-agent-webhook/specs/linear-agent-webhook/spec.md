## ADDED Requirements

### Requirement: Webhook endpoint validates Linear signature and returns 200 immediately
`POST /api/linear/webhook` SHALL validate the incoming request signature using HMAC-SHA256 with the stored `webhookSecret`. If valid, it SHALL return HTTP 200 immediately and defer all processing to an async handler.

#### Scenario: Valid signature
- **WHEN** a POST request arrives at `/api/linear/webhook` with a valid `linear-signature` header
- **THEN** the endpoint returns HTTP 200 immediately and begins deferred processing via `after()`

#### Scenario: Invalid signature
- **WHEN** a POST request arrives at `/api/linear/webhook` with an invalid or missing `linear-signature` header
- **THEN** the endpoint returns HTTP 401 and performs no processing

#### Scenario: No workspace connected
- **WHEN** a POST request arrives at `/api/linear/webhook` and no `linearWorkspaces` record exists (no webhookSecret to validate against)
- **THEN** the endpoint returns HTTP 401

### Requirement: Agent posts a thought activity to Linear within 10 seconds of webhook receipt
The deferred handler SHALL post a thought activity to Linear's agent session API as its first action, before creating a session or provisioning a sandbox.

#### Scenario: Thought activity posted promptly
- **WHEN** a valid `AgentSessionEvent` webhook is received
- **THEN** a thought activity is posted to the Linear agent session (e.g., "Starting on this, spinning up a session...") within 10 seconds of the webhook arriving

#### Scenario: Linear API unavailable for thought activity
- **WHEN** the Linear API call to post the thought activity fails
- **THEN** the error is logged and processing continues (session creation is still attempted)

### Requirement: Triggering user email is matched to an Open Agents user
The deferred handler SHALL look up the `actor.email` from the webhook payload in the `users` table to identify which Open Agents user owns the session.

#### Scenario: Email matches a known user
- **WHEN** the `actor.email` in the webhook payload matches a user in the `users` table
- **THEN** the new session is created and associated with that user

#### Scenario: Email does not match any user
- **WHEN** the `actor.email` in the webhook payload does not match any user in the `users` table
- **THEN** a comment is posted on the Linear issue: "Hey @{linearUsername}, {email} isn't connected to Open Agents yet. Sign in at {APP_URL} to run sessions from Linear."
- **THEN** no session is created and processing stops

### Requirement: Agent session is created linked to the Linear issue and agent session
When a matching user is found, the system SHALL create a session with `linearIssueId` and `linearAgentSessionId` populated from the webhook payload.

#### Scenario: Session created from webhook
- **WHEN** a valid webhook is received with a matching user email
- **THEN** a session is created with `linearIssueId` set to the issue ID from the payload, `linearAgentSessionId` set to the Linear agent session ID, and the issue content injected into the agent's initial context (reusing `linear-issue-linking` injection logic)

#### Scenario: Idempotent — duplicate webhook does not create duplicate session
- **WHEN** a webhook is received with a `linearAgentSessionId` that already exists on a session record
- **THEN** no new session is created and processing stops silently

### Requirement: Repo defaults to user's most recently used repository
When creating a session from a webhook event, the system SHALL use the user's most recently created session's repo as the default.

#### Scenario: User has prior sessions
- **WHEN** a webhook-triggered session is created for a user who has existing sessions
- **THEN** the new session uses the repo from the user's most recent prior session

#### Scenario: User has no prior sessions
- **WHEN** a webhook-triggered session is created for a user with no prior sessions
- **THEN** the session is created without a repo and the agent's initial message asks which repository to work in
