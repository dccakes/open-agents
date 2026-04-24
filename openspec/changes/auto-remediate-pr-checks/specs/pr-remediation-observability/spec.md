## ADDED Requirements

### Requirement: Remediation state is persisted per session and PR
The system SHALL persist remediation metadata sufficient to evaluate safety policy and show operator-visible state.

#### Scenario: Persist attempt outcome
- **WHEN** an automatic remediation attempt completes or is skipped
- **THEN** persisted state includes attempt counters, timestamps, and last outcome reason

### Requirement: Failure fingerprint and head SHA are auditable
The system MUST persist the latest evaluated head SHA and failure fingerprint used for dedupe decisions.

#### Scenario: Inspect repeated failures
- **WHEN** support or developer tooling inspects remediation state
- **THEN** stored head SHA and fingerprint history explain why retries happened or were skipped

### Requirement: Operational logs include remediation lifecycle events
The system SHALL emit structured logs for watcher start/stop, evaluation results, remediation triggers, and safety-limit stops.

#### Scenario: Safety stop logged
- **WHEN** remediation is stopped due to budget exhaustion or dedupe policy
- **THEN** a structured log event is emitted with session ID, PR number, and stop reason
