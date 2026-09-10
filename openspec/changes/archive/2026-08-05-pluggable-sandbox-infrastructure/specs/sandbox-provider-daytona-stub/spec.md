## ADDED Requirements

### Requirement: Daytona provider is registrable as beta capability
The system SHALL expose a Daytona provider entry that can be registered and selected when required configuration is present, and the provider SHALL be labeled as beta until hardening gates are complete.

#### Scenario: Register Daytona provider
- **WHEN** Daytona configuration is valid at startup
- **THEN** the provider registry includes the `daytona` provider definition with beta designation

### Requirement: Daytona provider maps sandbox operations to workspace primitives
The Daytona provider SHALL map sandbox command execution and preview URL resolution to Daytona workspace APIs.

#### Scenario: Execute command through Daytona workspace
- **WHEN** a command is executed in a `daytona` sandbox session
- **THEN** the provider delegates execution to the backing Daytona workspace command API

#### Scenario: Resolve Daytona preview URL
- **WHEN** code requests preview URL for a port in a `daytona` sandbox session
- **THEN** the provider returns the Daytona preview URL for that port

### Requirement: Daytona provider supports persistent pause/resume semantics
The Daytona provider SHALL support pausing and reconnecting persistent named sandboxes when supported by Daytona runtime APIs.

#### Scenario: Pause Daytona session
- **WHEN** a Daytona-backed session is hibernated/archived
- **THEN** provider pause behavior preserves resumable sandbox identity for later reconnect

### Requirement: Daytona provider uses secure git credential handling
The Daytona provider MUST avoid persisting credential-bearing git remote URLs and MUST use approved credential brokering/ephemeral auth mechanisms.

#### Scenario: Clone private repository
- **WHEN** Daytona provider clones or fetches private GitHub repository content
- **THEN** provider does not persist long-lived credential-bearing remote configuration in the workspace

### Requirement: Daytona provider fails gracefully when unavailable
The system MUST return actionable configuration errors when Daytona provider prerequisites are not met.

#### Scenario: Missing Daytona credentials
- **WHEN** a user attempts to create a `daytona` session without required credentials
- **THEN** session creation fails with a configuration error that names missing prerequisites
