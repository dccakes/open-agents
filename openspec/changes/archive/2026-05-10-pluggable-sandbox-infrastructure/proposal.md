## Why

The sandbox layer is currently hardwired to a single cloud provider, which blocks reliable local development and constrains session capabilities (credential handling, runtime options, and database setup). We need a provider-agnostic foundation now so teams can develop locally, reduce vendor lock-in, and safely expand sandbox capabilities.

## What Changes

- Introduce a pluggable sandbox provider registry and expand provider typing beyond the legacy single-provider model.
- Add a secure Daytona beta provider implementation to validate multi-provider extensibility, including persistent pause/resume and preview URL resolution.
- Add a Docker-based local sandbox provider that implements the shared sandbox interface for local development and testing.
- Add local Docker Compose infrastructure for development dependencies and Daytona services; this infrastructure is explicitly separate from the Docker sandbox provider runtime.
- Add session-level provider selection and optional DB provisioning controls in session creation APIs and UI.
- Add provider availability and fallback rules so only healthy/configured providers are selectable.
- Add an environment variable resolver layer (Vercel API or Infisical) and inject resolved variables during sandbox creation.
- Add database provisioning abstractions for Neon (cloud providers) and Docker Postgres (local provider), including lifecycle teardown tracking.
- Enforce security guardrails: provider integrations MUST avoid persisting credential-bearing git remotes and MUST redact secrets from logs.
- Migrate persisted legacy provider values from `cloud` to `vercel` for backward compatibility.

## Capabilities

### New Capabilities
- `sandbox-provider-registry`: Register, discover, and lifecycle-manage sandbox providers through a shared registry and capability contract.
- `sandbox-provider-docker`: Run sandbox sessions in local Docker containers with interface-compatible behavior.
- `sandbox-provider-daytona-stub`: Provide a Daytona-backed beta provider to validate extension points and secure command/domain mapping.
- `sandbox-session-configuration`: Allow session creators to choose provider and opt into database provisioning through API and UI.
- `sandbox-env-injection`: Resolve and inject sandbox environment variables from configured secret backends with denylist protection.
- `sandbox-db-provisioning`: Provision session-scoped databases per provider and inject connection metadata into sandbox runtime.
- `sandbox-local-dev-bootstrap`: Provide documented and scripted local setup for sandbox + database dependencies.

### Modified Capabilities
- None.

## Impact

- Affected packages: `packages/sandbox`, `apps/web` session and sandbox routes, web session creation UI.
- Data model changes: session state persists selected provider identity and provider-specific teardown metadata; optional additional columns only when required.
- New external dependencies/integrations: Docker Engine, Daytona SDK, Neon API, Infisical API.
- Operational changes: session creation flow gains provider capability/availability checks and optional provisioning steps.
- Security posture changes: provider implementations must pass credential-handling and secret-redaction requirements.
