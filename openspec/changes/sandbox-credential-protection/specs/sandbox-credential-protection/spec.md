## ADDED Requirements

### Requirement: Sandbox provider credentials are not stored as plaintext in the database
The system SHALL stop persisting sandbox provider API keys and tokens as plaintext values in `user_sandbox_configs.config`. Credentials SHALL either be sourced from environment configuration, or stored encrypted at rest using the same encryption helper already used for Linear workspace tokens. The `config` column SHALL retain only non-secret settings and references.

#### Scenario: Provider configuration is saved
- **WHEN** a user saves sandbox provider settings containing an API key
- **THEN** no plaintext credential value is present in the persisted `config` column

#### Scenario: Provider configuration is used to connect a sandbox
- **WHEN** a sandbox is provisioned for a user whose provider configuration includes a credential
- **THEN** the credential is resolved through the environment or decrypted at use time, and sandbox provisioning succeeds unchanged

#### Scenario: Existing plaintext credentials are removed
- **WHEN** the credential-protection migration runs against rows containing plaintext credentials
- **THEN** those values are removed from plaintext storage, and affected users are prompted to re-enter their credentials rather than silently losing sandbox access

#### Scenario: Reading a config row does not expose credentials to the client
- **WHEN** the sandbox settings UI loads a user's provider configuration
- **THEN** the response contains a masked indicator that a credential is set, never the credential value

### Requirement: The credential migration is sequenced to survive a rolling deploy
The removal of plaintext credential fields SHALL follow expand-contract: read paths SHALL be able to resolve credentials from the new location before the old plaintext values are removed, so that a previous deployment serving requests during a rollout does not lose access.

#### Scenario: Rolling deploy window
- **WHEN** the write path has moved to the new credential location but the previous deployment is still serving requests
- **THEN** sandbox provisioning continues to work on both deployments until the plaintext removal migration runs
