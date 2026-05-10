## ADDED Requirements

### Requirement: Env resolver backend is configurable
The system SHALL select env resolution backend by `SANDBOX_ENV_RESOLVER` and resolve env vars at session creation time.

#### Scenario: Use Vercel resolver backend
- **WHEN** `SANDBOX_ENV_RESOLVER=vercel`
- **THEN** session creation uses the Vercel resolver implementation to fetch injectable variables

#### Scenario: Use Infisical resolver backend
- **WHEN** `SANDBOX_ENV_RESOLVER=infisical`
- **THEN** session creation uses the Infisical resolver implementation to fetch injectable variables

### Requirement: Vercel resolver enforces scope and denylist
The Vercel resolver MUST restrict fetched variables to configured environment scope and MUST exclude denied variable names from injection.

#### Scenario: Denylisted variable present upstream
- **WHEN** Vercel returns variables including a denylisted key
- **THEN** that key is excluded from sandbox injection output

### Requirement: Resolved variables are injected into provider creation
The sandbox creation flow SHALL pass resolved environment variables into provider `create` operations when provider supports env injection.

#### Scenario: Env injection capable provider
- **WHEN** resolved variables are available and provider has `envInjection=true`
- **THEN** the provider receives the resolved variable set in sandbox creation options

### Requirement: Secret handling prevents persistence and log leakage
Provider integrations and resolver plumbing MUST avoid persisting sensitive credentials in git remotes/config and MUST redact sensitive values from logs.

#### Scenario: Provider git auth operation
- **WHEN** provider performs repository auth setup for private repository access
- **THEN** credential-bearing values are not persisted in workspace git remotes and are not emitted in plain text logs

### Requirement: Resolver failures fail session creation explicitly
The system MUST fail session creation with actionable error output when env resolver execution fails.

#### Scenario: Resolver backend error
- **WHEN** env resolution request returns an error (authentication, transport, or parsing)
- **THEN** session creation is rejected and the error identifies resolver failure as root cause
