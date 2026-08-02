## ADDED Requirements

### Requirement: Linear workspace lifecycle is admin-gated
The system SHALL require the `integration.connect` permission to initiate a Linear workspace OAuth connection and the `integration.disconnect` permission to disconnect one. Reading connection status SHALL remain available to any approved member.

#### Scenario: Member initiates a Linear connection
- **WHEN** a user with role `member` requests `/api/linear/connect`
- **THEN** the response is 403 and no OAuth redirect is issued

#### Scenario: Member disconnects the Linear workspace
- **WHEN** a user with role `member` posts to the Linear disconnect endpoint
- **THEN** the response is 403 and the workspace connection is unchanged

#### Scenario: Member reads connection status
- **WHEN** a user with role `member` requests the Linear connection status
- **THEN** the request succeeds and returns the connection state

#### Scenario: Admin disconnects the Linear workspace
- **WHEN** an admin completes the confirmed disconnect flow
- **THEN** the connection is disconnected and an audit record is written

### Requirement: The Linear webhook secret has a single source of truth
The system SHALL verify Linear webhook signatures using the secret stored on the workspace record, and SHALL NOT read a `LINEAR_WEBHOOK_SECRET` environment variable as an alternative or fallback source. The environment variable SHALL be removed from configuration and documentation.

#### Scenario: Webhook signature verification after a normal connect
- **WHEN** a Linear webhook is delivered for a connected workspace
- **THEN** the signature is verified against the secret stored on the workspace record

#### Scenario: Webhook signature verification after a restore
- **WHEN** a soft-deleted Linear workspace connection is restored and a webhook is delivered
- **THEN** signature verification succeeds using the restored record's secret, with no environment change required

#### Scenario: No environment fallback exists
- **WHEN** the webhook route is exercised with no `LINEAR_WEBHOOK_SECRET` set and a workspace record present
- **THEN** verification behavior is unchanged, demonstrating the environment variable is not consulted

### Requirement: Shared GitHub installations are admin-gated
The system SHALL distinguish organization-shared GitHub App installations from personal ones. Removing an organization-shared installation SHALL require `integration.disconnect`. Removing a personal installation SHALL remain available to its owning user. Existing installations SHALL remain personal after the migration; making an installation organization-shared SHALL be an explicit admin action.

#### Scenario: Member removes an org-shared installation
- **WHEN** a user with role `member` attempts to remove an installation marked organization-shared
- **THEN** the response is 403 and the installation record is unchanged

#### Scenario: User removes their own personal installation
- **WHEN** a user removes an installation they own that is not organization-shared
- **THEN** the removal succeeds

#### Scenario: Migration of existing installations
- **WHEN** the installation-ownership migration runs
- **THEN** every pre-existing installation is personal, and no installation becomes organization-shared without an explicit admin action

### Requirement: Organization-level sandbox defaults are admin-gated
The system SHALL require `orgSettings.update` to change organization-level sandbox defaults and to change which sandbox providers are enabled for the organization. Per-user provider selection and per-user provider configuration SHALL remain available to each user for their own records.

#### Scenario: Member changes the org default sandbox provider
- **WHEN** a user with role `member` submits a change to the organization default sandbox provider
- **THEN** the response is 403 and the default is unchanged

#### Scenario: Member changes their own sandbox preference
- **WHEN** a user with role `member` changes their personal default sandbox type
- **THEN** the change succeeds

#### Scenario: Admin disables a provider organization-wide
- **WHEN** an admin disables a sandbox provider for the organization
- **THEN** the provider is unavailable for selection by any member and an audit record is written

### Requirement: Observability integration configuration is admin-gated
The system SHALL require the `observability.configure` permission to enable, disable, or configure organization observability integrations. Reading which integrations are configured SHALL be available to approved members.

#### Scenario: Member changes observability configuration
- **WHEN** a user with role `member` submits an observability configuration change
- **THEN** the response is 403 and the configuration is unchanged

#### Scenario: Admin changes observability configuration
- **WHEN** an admin enables an observability integration
- **THEN** the change is persisted and an audit record is written

### Requirement: Gating is enforced on the server, not only in the UI
Every gated mutation SHALL be enforced in its server route or server action. Hiding a control in the UI SHALL NOT be the only enforcement for any gated operation.

#### Scenario: Direct API call bypassing hidden UI
- **WHEN** a caller without the required permission issues any gated integration mutation directly to its endpoint
- **THEN** the response is 403 and no state changes
