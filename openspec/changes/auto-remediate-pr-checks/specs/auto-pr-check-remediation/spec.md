## ADDED Requirements

### Requirement: Failing checks trigger automatic remediation flow
The system SHALL trigger remediation automatically when tracked required checks are in a failing state.

#### Scenario: Required checks fail
- **WHEN** PR evaluation finds one or more failing required checks
- **THEN** the system begins remediation message generation without user interaction

### Requirement: Remediation prompt includes actionable failure context
The system SHALL attach failing check context (annotations and logs when available) to the remediation prompt sent to the agent.

#### Scenario: Logs and annotations available
- **WHEN** check log and annotation APIs are accessible
- **THEN** remediation message includes packaged snippets for each failing check

#### Scenario: Logs unavailable
- **WHEN** check logs cannot be fetched due to permission or transient failure
- **THEN** the remediation message still includes failing check identity and a fallback fix prompt

### Requirement: Automatic remediation reuses standard chat execution path
The system MUST submit remediation as a synthetic chat input and execute through the existing chat workflow path.

#### Scenario: Start remediation run
- **WHEN** remediation message is generated
- **THEN** a new chat run is started using existing workflow orchestration and stream ownership guards

### Requirement: Post-remediation reevaluation is performed
The system SHALL reevaluate PR checks after a remediation attempt completes.

#### Scenario: Remediation run completes
- **WHEN** a remediation attempt finishes
- **THEN** the watcher schedules or triggers a follow-up check evaluation
