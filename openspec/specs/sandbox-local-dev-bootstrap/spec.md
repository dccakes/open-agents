# sandbox-local-dev-bootstrap Specification

## Purpose

Let a developer run the full provider stack locally from a compose file and a setup script, with credentials scoped to local use only.

## Requirements

### Requirement: Repository provides local dependency compose stack
The repository SHALL include a local compose definition for required sandbox development dependencies, including Postgres health checks and provider-support services.

#### Scenario: Start local dependencies
- **WHEN** a developer runs the documented compose startup command
- **THEN** required services start and report healthy status before dependent workflows continue

### Requirement: Setup script bootstraps local environment
The repository SHALL include a setup script that prepares local runtime prerequisites and environment file scaffolding for web development.

#### Scenario: Run dev setup script
- **WHEN** a developer executes the setup script on a fresh clone
- **THEN** local dependency startup and environment bootstrap steps complete or fail with actionable prompts

### Requirement: Local stack credentials are generated and scoped for local use
Local bootstrap tooling MUST generate or inject development credentials in a local-only scope and MUST document that these values are not production-safe.

#### Scenario: Local credential bootstrap
- **WHEN** local setup provisions provider credentials or API keys
- **THEN** generated credentials are scoped/documented as development-only and are not shipped as production defaults

### Requirement: Local development runbook is documented
The repository SHALL include a local development guide covering prerequisites, setup, provider selection, and verification steps.

#### Scenario: Follow documented local setup
- **WHEN** a developer follows the runbook on a new machine
- **THEN** they can create and run at least one local provider-backed sandbox session
