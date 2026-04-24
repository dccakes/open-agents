## ADDED Requirements

### Requirement: GitHub webhook ingestion handles check-related events
The system SHALL process relevant GitHub events (`check_run`, `check_suite`, `workflow_run`, and qualifying `pull_request` actions) to trigger PR check evaluation.

#### Scenario: check_run completion event
- **WHEN** a `check_run` event indicates a completed run on a tracked PR head SHA
- **THEN** the system queues or executes an idempotent PR check evaluation

### Requirement: Event correlation to sessions is deterministic
The system MUST correlate incoming events to linked sessions using repository identity and PR number (or equivalent resolvable identifiers).

#### Scenario: Event for unlinked PR
- **WHEN** a webhook event references a PR with no linked session
- **THEN** the system records an ignored outcome and performs no remediation action

### Requirement: Event processing is idempotent
The system MUST avoid duplicate remediation triggers for duplicated webhook deliveries.

#### Scenario: Duplicate delivery for same event payload
- **WHEN** the same GitHub delivery/event is received more than once
- **THEN** evaluation side effects are applied at most once
