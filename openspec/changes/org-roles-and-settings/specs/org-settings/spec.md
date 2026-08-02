## ADDED Requirements

### Requirement: Organization settings are stored per organization
The system SHALL store organization-wide settings in an `org_settings` table keyed by a unique `organizationId` foreign key, with typed columns rather than an untyped metadata blob. The record SHALL carry at minimum `agentRunsPaused` (boolean, non-null, default false) and `dailyTokenBudget` (integer, nullable meaning unlimited). A settings record SHALL exist for the seeded organization from the migration onward.

#### Scenario: Settings record is created with the organization
- **WHEN** the seeding migration runs
- **THEN** an `org_settings` row exists for the seeded organization with `agentRunsPaused` false

#### Scenario: Settings are read
- **WHEN** any approved member reads org settings
- **THEN** the response contains the current kill-switch state and daily token budget

#### Scenario: Settings are updated without permission
- **WHEN** a caller lacking `orgSettings.update` submits a settings change
- **THEN** the response is 403 and no column is modified

#### Scenario: Settings are updated with permission
- **WHEN** a caller holding `orgSettings.update` changes the daily token budget
- **THEN** the value is persisted and an audit record capturing the previous and new value is written

### Requirement: The kill switch prevents new agent runs from starting
When `agentRunsPaused` is true, the system SHALL refuse to start any new agent workflow run at every run-start path — interactive chat runs and webhook-triggered runs alike — and SHALL surface a clear paused state to the caller. Clearing the flag SHALL restore service without a deployment or restart.

#### Scenario: Chat run start while paused
- **WHEN** an approved member starts a chat run and `agentRunsPaused` is true
- **THEN** no workflow run is created and the caller receives a structured "agent runs are paused" response

#### Scenario: Webhook-triggered run while paused
- **WHEN** a webhook-triggered run would start and `agentRunsPaused` is true
- **THEN** no workflow run is created and the pause is reported through the trigger's failure-visibility path rather than only a log line

#### Scenario: Kill switch is cleared
- **WHEN** an admin sets `agentRunsPaused` back to false
- **THEN** the next run-start request succeeds, with no deployment or process restart required

#### Scenario: In-flight runs during a pause
- **WHEN** the kill switch is set while runs are already executing
- **THEN** those in-flight runs are not terminated by this capability, and the UI states that the switch stops new runs only

### Requirement: The kill switch is admin-only and audited
Only callers holding `orgSettings.update` SHALL be able to change `agentRunsPaused`, and every change SHALL produce an audit record identifying the actor, the new value, and the time.

#### Scenario: Member attempts to flip the kill switch
- **WHEN** a user with role `member` posts a kill-switch change
- **THEN** the response is 403 and the value is unchanged

#### Scenario: Admin flips the kill switch
- **WHEN** an admin sets `agentRunsPaused` to true
- **THEN** the value is persisted and an audit record with actor and timestamp is written in the same transaction

### Requirement: The kill switch fails closed on read failure
If the org settings record cannot be read at a run-start path, the system SHALL refuse to start the run rather than defaulting to permitted.

#### Scenario: Settings read fails at run start
- **WHEN** the org settings lookup errors during a run-start request
- **THEN** no workflow run is created and the caller receives an error

### Requirement: The org daily token budget is exposed for downstream enforcement
The system SHALL expose the configured `dailyTokenBudget` through a typed accessor so that run-budget enforcement can consume it. This capability owns the value's storage, permission gating, and audit; it does not itself halt runs on budget breach.

#### Scenario: Budget value is read by a consumer
- **WHEN** a consumer reads the org daily token budget
- **THEN** it receives the configured integer, or an explicit "unlimited" when the column is null
