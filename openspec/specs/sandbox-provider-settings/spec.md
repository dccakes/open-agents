## Requirements

### Requirement: Settings navigation includes Sandboxes page
The app SHALL expose a Sandboxes page reachable from the Settings navigation at the path `/settings/sandboxes`.

#### Scenario: User navigates to Sandboxes settings
- **WHEN** an authenticated user clicks Settings in the app navigation
- **THEN** a "Sandboxes" item is visible in the Settings sidebar and navigates to `/settings/sandboxes`

---

### Requirement: Provider card shows structural availability
The Sandboxes page SHALL render one card per registered sandbox provider. Cards for structurally unavailable providers (where `provider.isAvailable()` returns `false` due to platform or env constraints) SHALL be displayed in a disabled, non-interactive state.

#### Scenario: Structurally unavailable provider
- **WHEN** a provider's `isAvailable()` returns `false`
- **THEN** its card is visually greyed out, the enable toggle is disabled, and a tooltip shows the reason from `provider.reasonUnavailable()`

#### Scenario: Structurally available provider
- **WHEN** a provider's `isAvailable()` returns `true`
- **THEN** its card is interactive and the enable toggle is clickable

---

### Requirement: Provider card reflects enabled/configured state
Each provider card SHALL display a status indicator that reflects the combination of user-enabled state and configuration completeness.

#### Scenario: Provider is disabled (default state)
- **WHEN** the provider has never been enabled by the user
- **THEN** the card shows the provider name and logo with a grey indicator and the toggle in the off position

#### Scenario: Provider is enabled but not configured
- **WHEN** the user has toggled a provider on but has not saved all required config fields
- **THEN** the card shows a red/amber status indicator and the configuration form is expanded inline

#### Scenario: Provider is enabled and fully configured
- **WHEN** the provider is enabled and all required `configFields` have been saved
- **THEN** the card shows a green "Configured" status indicator, the toggle in the on position, and a Settings button — the inline form is collapsed

---

### Requirement: Provider enable/disable toggle
The user SHALL be able to enable or disable a structurally available provider via a toggle on its card.

#### Scenario: User enables a provider
- **WHEN** the user toggles an available, currently-disabled provider on
- **THEN** the card expands to show the configuration form and the enabled state is persisted to `userSandboxConfigs`

#### Scenario: User disables a provider
- **WHEN** the user toggles an enabled provider off
- **THEN** the card collapses, the provider is removed from the selectable providers list, and the disabled state is persisted; saved config is retained (not deleted)

---

### Requirement: Provider configuration form
Each provider card SHALL render a form derived from the provider's `configFields` definition. The form is shown inline when the provider is enabled but not yet fully configured, or via a modal when the user clicks the Settings button on a configured card.

#### Scenario: Form renders provider-specific fields
- **WHEN** a provider card's configuration form is shown
- **THEN** each field in `provider.configFields` is rendered with its label, type (`text`, `url`, `password`), placeholder, and required indicator

#### Scenario: Password fields are masked
- **WHEN** a field has type `password`
- **THEN** its value is rendered as a password input and existing saved values are displayed as masked placeholders (not the raw value)

#### Scenario: Saving a complete configuration
- **WHEN** the user fills all required fields and clicks Save
- **THEN** the config is persisted via `PATCH /api/settings/sandbox-providers/[providerType]` and the card enters the configured state

#### Scenario: Saving an incomplete configuration
- **WHEN** the user clicks Save with one or more required fields empty
- **THEN** validation errors are shown inline and no API call is made

#### Scenario: Re-editing a configured provider
- **WHEN** the user clicks the Settings button on a configured card
- **THEN** a modal opens with all fields pre-populated (password fields shown as masked placeholders) and the user can update and save

---

### Requirement: Provider configFields registry extension
Each `SandboxProviderDef` SHALL optionally declare a `configFields: SandboxConfigField[]` array describing the user-facing configuration fields for that provider.

#### Scenario: Vercel provider config fields
- **WHEN** the Vercel provider card form is rendered
- **THEN** fields include: Base Snapshot ID (`VERCEL_SANDBOX_BASE_SNAPSHOT_ID`, optional), Vercel Team (`VERCEL_TEAM`, optional), Vercel Project (`VERCEL_PROJECT`, optional)

#### Scenario: Docker provider config fields
- **WHEN** the Docker provider card form is rendered
- **THEN** fields include: Sandbox Image (`DOCKER_SANDBOX_IMAGE`, required, with placeholder `open-agents/sandbox-dev:latest`)

#### Scenario: Daytona provider config fields
- **WHEN** the Daytona provider card form is rendered
- **THEN** fields include: Server URL (`DAYTONA_SERVER_URL`, required, type `url`), API Key (`DAYTONA_API_KEY`, required, type `password`)

---

### Requirement: Settings API for provider config
The system SHALL expose REST endpoints to read and write per-user sandbox provider configuration.

#### Scenario: Reading provider configs
- **WHEN** `GET /api/settings/sandbox-providers` is called by an authenticated user
- **THEN** the response contains the enabled state and non-sensitive config fields for each provider registered in the system

#### Scenario: Updating a provider config
- **WHEN** `PATCH /api/settings/sandbox-providers/[providerType]` is called with `{ enabled, config }`
- **THEN** the row in `userSandboxConfigs` is upserted and the response returns the updated state

#### Scenario: Unauthorized access
- **WHEN** an unauthenticated request is made to any `/api/settings/sandbox-providers` endpoint
- **THEN** the response is `401 Unauthorized`
