## ADDED Requirements

### Requirement: Approvals are persisted as server-side records
The system SHALL persist an `approval` record whenever a policy decision of `ask` pauses a run or gates an application-level side effect. Each record SHALL identify the session, the chat and workflow run where applicable, the kind of approval, the tool name and tool call id where applicable, a redacted summary of the requested operation, the decision, the deciding user, the expiry time, and the created and decided timestamps.

#### Scenario: An approval request creates a record
- **WHEN** a tool call produces an `ask` decision and the run pauses
- **THEN** an `approval` row exists in a pending state identifying the session, tool, and requested operation

#### Scenario: A decision is recorded with its decider
- **WHEN** a user approves or denies a pending approval
- **THEN** the row records the decision, the deciding user, and the decision time

### Requirement: Execution requires a matching server-side approval, not a client assertion
Before executing an operation whose decision was `ask`, the system SHALL verify a persisted approval record for that operation in the `approved` state. A resumed request that asserts approval without a matching record SHALL be refused.

#### Scenario: Forged approval in the request body
- **WHEN** a resumed request carries an approved tool state for which no approved record exists
- **THEN** the operation is refused and nothing is executed

#### Scenario: Approval record present
- **WHEN** a resumed request carries an approved tool state backed by an approved record
- **THEN** the operation executes

#### Scenario: Approvals are single use
- **WHEN** a request replays a message body whose approval was already consumed by an execution
- **THEN** the operation is refused

### Requirement: Only a user entitled to act on the session may decide an approval
The system SHALL authorize the decider before recording a decision. A caller who may not act on the session SHALL receive 403 and the record SHALL remain pending.

#### Scenario: Unauthorized decision attempt
- **WHEN** a user who may not act on the session submits an approval decision
- **THEN** the response is 403 and the approval stays pending

#### Scenario: Authorized decision
- **WHEN** a user entitled to act on the session approves a pending request
- **THEN** the decision is recorded

### Requirement: Approvals expire, and expiry is a denial
A pending approval SHALL carry an expiry, defaulting to 24 hours and configurable. An approval past its expiry SHALL be treated as denied by every reader, in every environment, whether or not a scheduled job has run. A scheduled handler SHALL additionally materialize the terminal state and record the corresponding policy event, and SHALL return without writing unless the deployment environment is production.

#### Scenario: Expired approval is treated as denied on read
- **WHEN** a run resumes against an approval whose expiry has passed
- **THEN** the operation is refused as denied, without waiting for any job to run

#### Scenario: An expired approval is not re-prompted
- **WHEN** an approval expires
- **THEN** the user is not asked again for the same operation; the model receives a denial

#### Scenario: The sweeper is production-only
- **WHEN** the expiry sweeper runs outside production
- **THEN** it returns immediately, writes nothing, and reports that it was skipped

#### Scenario: The sweeper runs in production
- **WHEN** the sweeper runs in production
- **THEN** expired pending approvals are materialized as denied and a policy event is recorded for each

### Requirement: Approvals survive process restarts and sandbox hibernation
A pending approval SHALL remain valid across a restart of the serving process and across hibernation or teardown of the session's sandbox. On resume, the system SHALL restore or reprovision the sandbox before executing the approved operation.

#### Scenario: Approval decided after the sandbox hibernates
- **WHEN** an approval is granted two hours after it was requested, by which time the session's sandbox has hibernated
- **THEN** the sandbox is restored or reprovisioned and the approved command executes

#### Scenario: Approval decided after a process restart
- **WHEN** the serving process restarts between the request and the decision
- **THEN** the pending approval is still present and can be decided

#### Scenario: The user is told what resume means
- **WHEN** an approval is presented for a session whose sandbox may be restored before execution
- **THEN** the UI identifies the session and the exact operation being approved and does not promise that transient in-sandbox state is preserved

### Requirement: Application-level side effects are approvable
Commit and pull-request operations performed by the application outside tool dispatch SHALL be gated by the same approval mechanism when the posture requires it, using an approval record of an application-side-effect kind. Granting the approval SHALL cause the operation to be performed; denying it SHALL skip the operation for that run.

#### Scenario: Auto-commit under strict pauses
- **WHEN** an automatic commit would run at the end of a `strict` session's turn
- **THEN** it does not run, and a pending application-side-effect approval is surfaced on the run

#### Scenario: Granting executes the side effect
- **WHEN** that pending approval is granted
- **THEN** the commit is performed

#### Scenario: Denying skips the side effect
- **WHEN** that pending approval is denied
- **THEN** no commit or push is performed and the run reports that it was skipped by policy

#### Scenario: Unchanged under auto
- **WHEN** the same turn ends in an `auto` session with a policy that allows the operation
- **THEN** the automatic commit runs exactly as it does today

### Requirement: Approval prompts reuse the existing chat interaction rails
Approval prompts SHALL be surfaced through the chat UI's existing tool-approval affordances rather than a parallel interaction mechanism, and SHALL show the tool, the exact operation, the matching rule, and the posture that caused the pause.

#### Scenario: A pending approval is rendered in chat
- **WHEN** a run pauses for approval
- **THEN** the chat shows an interactive approve/deny prompt naming the tool, the operation, the rule, and the posture

#### Scenario: Answering resumes the run
- **WHEN** the user answers the prompt
- **THEN** the run resumes without further user action
