## ADDED Requirements

### Requirement: Sessions carry a security posture
The system SHALL store a posture on the `sessions` table as a non-null column with the values `strict`, `auto`, and `dangerous`, defaulting to `auto`. The posture SHALL apply to every chat belonging to that session.

#### Scenario: Existing sessions keep today's behaviour
- **WHEN** the migration adds the column to a database with existing sessions
- **THEN** every existing session has posture `auto` and its behaviour is unchanged

#### Scenario: Posture is uniform across a session's chats
- **WHEN** a session's posture is `strict` and a user opens a second chat in that session
- **THEN** the second chat is also evaluated under `strict`

### Requirement: The auto posture lets policy decide
Under `auto`, a tool call SHALL proceed when the policy decision is `allow`, pause for approval when the decision is `ask`, and be refused when the decision is `deny`.

#### Scenario: Denied command under auto
- **WHEN** an `rm -rf ~` variant is issued in an `auto` session
- **THEN** the command is refused with no user interaction and nothing is executed

#### Scenario: Allowed commands under auto
- **WHEN** list, build, and test commands are issued in an `auto` session
- **THEN** they execute without interruption

### Requirement: The strict posture requires approval for side-effecting operations
Under `strict`, every side-effecting operation SHALL require approval unless the policy explicitly allows it — including bash write-class commands, network egress, pushes, and the application's own commit and pull-request side effects. Read-only operations SHALL remain unimpeded.

#### Scenario: Push requires approval under strict
- **WHEN** `git push` is issued in a `strict` session
- **THEN** the run pauses for approval before anything reaches the remote

#### Scenario: Approving proceeds
- **WHEN** the pending approval for that push is approved
- **THEN** the command executes

#### Scenario: Denying returns to the model
- **WHEN** the pending approval for that push is denied
- **THEN** the command does not execute, the model receives a structured denial as the tool result, and the run continues

#### Scenario: Read-only work is unaffected under strict
- **WHEN** file reads, greps, and globs are issued in a `strict` session
- **THEN** they execute without approval

### Requirement: The dangerous posture collapses ask to allow but never bypasses deny
Under `dangerous`, decisions of `ask` SHALL be treated as `allow`. Decisions of `deny` SHALL still refuse the operation. No posture SHALL be able to disable a `deny` rule.

#### Scenario: Ask becomes allow
- **WHEN** a command that would ask under `auto` is issued in a `dangerous` session
- **THEN** it executes without pausing

#### Scenario: Deny still denies
- **WHEN** an `rm -rf /`-class command is issued in a `dangerous` session
- **THEN** it is refused

### Requirement: Selecting the dangerous posture requires permission and is visibly marked
Setting a session's posture to `dangerous` SHALL require the `posture.setDangerous` permission. A session whose posture is `dangerous` SHALL display a persistent badge in the UI. Selecting `strict` or `auto` SHALL require only that the caller may act on the session.

#### Scenario: A member cannot select dangerous
- **WHEN** a user without `posture.setDangerous` submits a posture change to `dangerous`
- **THEN** the response is 403 and the posture is unchanged

#### Scenario: An admin selects dangerous
- **WHEN** a user holding `posture.setDangerous` sets a session to `dangerous`
- **THEN** the posture is persisted and the session shows the badge

#### Scenario: The control is hidden but also enforced
- **WHEN** a user without the permission views the posture selector
- **THEN** the `dangerous` option is not offered, and the server refuses it if submitted directly

### Requirement: Non-interactive triggers can never run under the dangerous posture
The posture-resolution path SHALL refuse to resolve `dangerous` for a run that has no interactive approver, regardless of stored configuration. Such a run SHALL fall back to `auto`.

#### Scenario: A webhook-configured dangerous posture is refused
- **WHEN** a non-interactive trigger requests a run under `dangerous`
- **THEN** the run proceeds under `auto` and the downgrade is recorded

### Requirement: Posture changes apply to subsequent tool calls, not retroactively
Changing a session's posture SHALL affect tool calls evaluated after the change. It SHALL NOT terminate a run in flight or undo work already performed, and the UI SHALL state this.

#### Scenario: Posture tightened during a run
- **WHEN** a session's posture is changed from `auto` to `strict` while a run is executing
- **THEN** the run is not terminated, subsequent side-effecting tool calls in later steps are gated, and the UI states that the change applies to subsequent operations

### Requirement: Subagents inherit the session posture
Every subagent launched from a session SHALL be evaluated under that session's posture and policy. A subagent SHALL NOT be able to widen its own permissions.

#### Scenario: A subagent runs under the session posture
- **WHEN** a subagent is launched from a `strict` session
- **THEN** its tool calls are evaluated under `strict`

#### Scenario: Explorer is further restricted
- **WHEN** a subagent declared read-only is launched from a session under any posture
- **THEN** its policy profile is at least as restrictive as the session's
