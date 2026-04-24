## ADDED Requirements

### Requirement: Provider registry manages sandbox providers by type
The system SHALL maintain a registry that maps each provider type to exactly one provider definition and exposes registration/discovery operations.

#### Scenario: Discover registered provider
- **WHEN** a caller requests provider metadata for a registered provider type
- **THEN** the registry returns that provider's definition including capabilities and label

#### Scenario: Reject unknown provider type
- **WHEN** a caller requests a provider for an unregistered provider type
- **THEN** the system returns a typed error indicating provider type is unsupported

### Requirement: Sandbox lifecycle dispatch uses provider implementations
The system SHALL dispatch sandbox `create` and `connect` lifecycle operations through the provider resolved by provider type.

#### Scenario: Create sandbox through registry
- **WHEN** session creation requests sandbox creation for a registered provider
- **THEN** the registry invokes that provider's `create` implementation and returns a sandbox instance

#### Scenario: Reconnect sandbox through registry
- **WHEN** an existing session with persisted provider state is reconnected
- **THEN** the registry invokes that provider's `connect` implementation

### Requirement: Providers declare capability metadata
Each provider definition MUST declare `db`, `envInjection`, `persistent`, and `credentialBrokering` capability flags.

#### Scenario: Read provider capabilities
- **WHEN** UI or API code requests provider capabilities
- **THEN** the returned metadata includes all required capability fields for each provider

### Requirement: Providers declare runtime availability
Each provider definition MUST expose availability information (`isAvailable`, `reasonUnavailable`) used by API and UI flows.

#### Scenario: Unavailable provider
- **WHEN** provider prerequisites are missing or unhealthy
- **THEN** registry marks the provider unavailable and returns a human-readable unavailability reason

### Requirement: Provider runtime contract includes async preview URL resolution
The shared runtime contract MUST support provider-resolved preview URL lookup via async semantics and optional pause behavior.

#### Scenario: Resolve preview URL for provider with async routing
- **WHEN** API code requests preview URL for a provider-managed port
- **THEN** provider runtime resolves and returns the preview URL asynchronously

### Requirement: Legacy provider values remain compatible
The system MUST treat persisted legacy provider value `cloud` as equivalent to `vercel` during migration.

#### Scenario: Reconnect legacy cloud session
- **WHEN** a session persisted with provider value `cloud` is loaded
- **THEN** sandbox lifecycle dispatch resolves to the `vercel` provider path
