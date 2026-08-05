# sandbox-session-configuration Specification

## Purpose

Let session creation choose a sandbox provider and database option, with the server — not the client — enforcing what is actually available.

## Requirements

### Requirement: Session creation accepts provider and DB provisioning options
Session creation APIs SHALL accept provider selection and `provisionDb` inputs with schema validation.

#### Scenario: Create session with explicit provider
- **WHEN** a caller submits session creation with provider `docker` and `provisionDb=false`
- **THEN** the session is created using Docker provider and no database provisioning flow is started

#### Scenario: Default provider behavior
- **WHEN** a caller omits provider selection
- **THEN** the API applies the configured default provider and persists the resolved provider identity in session runtime state

### Requirement: Session creation UI surfaces only available providers
The session creation UI SHALL list providers from the registry filtered to providers whose runtime availability checks pass.

#### Scenario: Hide unavailable provider
- **WHEN** a provider is registered but missing required runtime configuration
- **THEN** the UI does not present that provider as selectable

### Requirement: Server-side fallback enforces availability rules
Session creation APIs MUST enforce provider availability independently of UI filtering.

#### Scenario: Client submits unavailable provider
- **WHEN** a session creation request specifies an unavailable provider
- **THEN** the API returns an actionable provider-unavailable error or applies configured fallback behavior

### Requirement: DB option is capability-gated
The UI MUST show the "Provision database" option only for providers with `capabilities.db=true`.

#### Scenario: Provider without DB capability
- **WHEN** the selected provider has `capabilities.db=false`
- **THEN** the DB provisioning toggle is hidden or disabled and cannot be submitted as true

### Requirement: Session records persist selected configuration
Session persistence SHALL store selected provider identity and provisioning metadata required for reconnect and teardown flows.

#### Scenario: Load persisted session
- **WHEN** an existing session is loaded
- **THEN** provider and DB provisioning state can be read from persisted session runtime/persistence fields
