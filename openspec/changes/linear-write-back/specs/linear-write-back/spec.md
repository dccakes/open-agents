## ADDED Requirements

### Requirement: Session started event posts a Linear activity
When a session with a `linearAgentSessionId` is successfully created, the system SHALL post a "session started" activity to Linear. This activity SHALL be skipped for webhook-triggered sessions (to avoid duplicate announcements after the thought activity).

#### Scenario: UI-triggered session with linked issue starts
- **WHEN** a session is created via the UI with a `linearIssueId` and `linearAgentSessionId` is set
- **THEN** a Linear activity is posted: "🚀 Session started" with a "View full session →" link

#### Scenario: Webhook-triggered session does not post duplicate started activity
- **WHEN** a session is created via the Linear webhook handler (which already posted a thought activity)
- **THEN** no additional "session started" activity is posted

#### Scenario: Session without linearAgentSessionId
- **WHEN** a session is created with no `linearAgentSessionId`
- **THEN** no Linear activity is posted and no error occurs

### Requirement: PR creation posts a Linear activity
When a pull request is created for a session that has a `linearAgentSessionId`, the system SHALL post a PR activity to Linear.

#### Scenario: PR opened for a linked session
- **WHEN** a `pull_request` webhook event arrives and the associated session has a `linearAgentSessionId`
- **THEN** a Linear activity is posted: "🔀 Created PR #{number}: {title}" with the PR URL and a "View full session →" link

#### Scenario: PR opened for a non-linked session
- **WHEN** a `pull_request` webhook event arrives and the session has no `linearAgentSessionId`
- **THEN** no Linear activity is posted

### Requirement: Session blocked/error event posts a Linear activity
When a session enters a blocked or error state and has a `linearAgentSessionId`, the system SHALL post a blocked/error activity to Linear.

#### Scenario: Session enters error state
- **WHEN** a session transitions to an error state and has a `linearAgentSessionId`
- **THEN** a Linear activity is posted: "❌ Session failed: {error summary}" with a "View full session →" link

#### Scenario: Session is blocked waiting for input
- **WHEN** the agent signals it needs user input and the session has a `linearAgentSessionId`
- **THEN** a Linear activity is posted: "🚧 Agent needs input" with a "View full session →" link

### Requirement: Session completed event posts a Linear activity
When a session completes successfully (PR merged or agent finishes work) and has a `linearAgentSessionId`, the system SHALL post a completion activity to Linear.

#### Scenario: Session completes successfully
- **WHEN** a session is archived after successful completion (PR merged or work finished) and has a `linearAgentSessionId`
- **THEN** a Linear activity is posted: "✅ Session complete" with a "View full session →" link

#### Scenario: Session archived due to inactivity
- **WHEN** a session is archived due to inactivity (not active completion)
- **THEN** no Linear activity is posted

### Requirement: Write-back failures do not affect primary operations
All Linear write-back calls SHALL be fire-and-forget. A failure to post a Linear activity SHALL NOT affect the primary operation (session creation, PR recording, archival).

#### Scenario: Linear API unavailable during write-back
- **WHEN** a session lifecycle event triggers a Linear write-back and the Linear API is unavailable
- **THEN** the error is logged, the primary operation completes normally, and no error is surfaced to the user

### Requirement: Activity format includes session link
All Linear activity posts SHALL include a markdown link to the full Open Agents session at `{APP_URL}/sessions/{sessionId}`.

#### Scenario: Activity includes session link
- **WHEN** any write-back activity is posted to Linear
- **THEN** the activity body contains a "View full session →" link pointing to the correct session URL
