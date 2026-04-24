## ADDED Requirements

### Requirement: System starts a PR check watcher for eligible sessions
The system SHALL start a durable PR check watcher when an auto-created PR is available for a session and when relevant PR lifecycle events indicate an open PR requires monitoring.

#### Scenario: Start watcher after auto PR creation
- **WHEN** auto-PR creation completes with an open PR number
- **THEN** the system starts or refreshes a watcher run for that session and PR

#### Scenario: Start watcher after PR synchronize event
- **WHEN** a `pull_request` webhook event with action `synchronize` is received for a linked session PR
- **THEN** the system ensures a watcher exists and evaluates current check state

### Requirement: Watcher enforces single active lease per session
The system MUST allow at most one active watcher lease per session.

#### Scenario: Concurrent watcher start attempts
- **WHEN** multiple trigger paths attempt to start watcher logic for the same session
- **THEN** only one watcher lease is active and duplicate starts become no-ops

### Requirement: Watcher stops on terminal PR states
The watcher MUST stop monitoring when the tracked PR is merged or closed.

#### Scenario: PR merged while watcher running
- **WHEN** PR state transitions to merged
- **THEN** watcher lease is released and no further remediation attempts are scheduled
