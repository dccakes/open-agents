# sandbox-db-provisioning Specification

## Purpose

Give a session an optional, session-scoped database that is provisioned by the right backend for its provider and torn down when the session ends.

## Requirements

### Requirement: Database provisioning is explicit and session-scoped
The system SHALL provision a database only when `provisionDb=true` for a session and SHALL scope provisioned resources to that session.

#### Scenario: DB provisioning disabled
- **WHEN** session creation is submitted with `provisionDb=false`
- **THEN** no database provisioning calls are made

#### Scenario: DB provisioning enabled
- **WHEN** session creation is submitted with `provisionDb=true`
- **THEN** the system provisions a session-scoped database resource before sandbox runtime start

### Requirement: Provisioner selection depends on provider type
The system SHALL select provisioner implementation by selected sandbox provider.

#### Scenario: Cloud provider chooses Neon
- **WHEN** provider is `vercel` or `daytona` and `provisionDb=true`
- **THEN** the Neon provisioner implementation is used

#### Scenario: Docker provider chooses local Postgres
- **WHEN** provider is `docker` and `provisionDb=true`
- **THEN** the Docker Postgres provisioner implementation is used

### Requirement: Provisioned connection URL is injected into runtime
The system MUST inject provisioned database connection information into sandbox runtime as `POSTGRES_URL`.

#### Scenario: Provisioned DB URL available in sandbox
- **WHEN** a session provisions a database successfully
- **THEN** sandbox runtime environment includes `POSTGRES_URL` for agent command execution

### Requirement: Provisioned resource identifiers are persisted for teardown
The system SHALL persist provider-specific teardown metadata (including Neon branch identifiers where applicable) in session records.

#### Scenario: Persist teardown metadata
- **WHEN** DB provisioning succeeds for a session
- **THEN** session persistence stores required teardown identifiers for later cleanup

### Requirement: Session termination attempts provisioned resource cleanup
The system MUST attempt teardown of provisioned database resources when sessions end.

#### Scenario: End session with provisioned DB
- **WHEN** a session with provisioned database is terminated
- **THEN** the system triggers provider-specific database teardown and records success or failure outcome
