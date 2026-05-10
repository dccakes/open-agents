## ADDED Requirements

### Requirement: Sessions store optional Linear issue reference
A session record SHALL include optional fields `linearIssueId`, `linearIssueUrl`, and `linearAgentSessionId` to support Linear integration. These fields SHALL be nullable and have no effect on sessions that do not use Linear.

#### Scenario: Session created with Linear issue
- **WHEN** a session is created with a `linearIssueId` provided
- **THEN** the session record stores `linearIssueId`, `linearIssueUrl`, and (if provided) `linearAgentSessionId`

#### Scenario: Session created without Linear issue
- **WHEN** a session is created without a `linearIssueId`
- **THEN** `linearIssueId`, `linearIssueUrl`, and `linearAgentSessionId` are null and behavior is unchanged from pre-integration
