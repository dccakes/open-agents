## 1. Provider Registry Foundation

- [x] 1.1 Expand provider typing/capability metadata and add backward-compatible `cloud` -> `vercel` mapping.
- [x] 1.2 Implement registry with provider registration, discovery, availability checks, and typed create/connect dispatch.
- [x] 1.3 Refactor sandbox entrypoints to use registry dispatch instead of provider-specific branching.
- [x] 1.4 Register existing Vercel provider under `vercel` and validate legacy reconnect behavior for sessions persisted as `cloud`.

## 2. Daytona Beta Provider

- [x] 2.1 Implement Daytona provider module through the shared provider contract.
- [x] 2.2 Implement Daytona command execution and async preview URL resolution behavior.
- [x] 2.3 Implement Daytona pause/resume semantics for persistent named sandboxes.
- [x] 2.4 Gate Daytona availability on runtime/config prerequisites with actionable unavailability reasons.

## 3. Docker Provider Runtime

- [x] 3.1 Create Docker provider module implementing the shared sandbox runtime contract.
- [x] 3.2 Implement Docker exec/file/close/preview behavior with localhost port mapping.
- [x] 3.3 Add Docker provider capability metadata (`persistent=false`, `db=true`, `envInjection=true`, `credentialBrokering=false`).
- [x] 3.4 Add actionable error handling for missing/unreachable Docker runtime dependencies.

## 4. Environment Variable Injection

- [x] 4.1 Define env resolver interface and backend selection via `SANDBOX_ENV_RESOLVER`.
- [x] 4.2 Implement Vercel resolver with environment scoping and denylist filtering.
- [x] 4.3 Implement Infisical resolver with configured token/project/environment lookup.
- [x] 4.4 Integrate resolver into session creation sandbox flow and hard-fail on resolver errors.

## 5. Database Provisioning

- [x] 5.1 Define database provisioner interface for session-scoped provision/teardown.
- [x] 5.2 Implement Neon provisioner for cloud providers and persist teardown metadata.
- [x] 5.3 Implement Docker Postgres provisioner for local provider workflows.
- [x] 5.4 Inject provisioned `POSTGRES_URL` into sandbox runtime creation options.
- [x] 5.5 Ensure session termination path triggers provisioner teardown and records outcomes.

## 6. Session API, Persistence, and UI

- [x] 6.1 Extend session creation API validation to accept provider selection and `provisionDb`.
- [x] 6.2 Persist provider identity in session runtime state and add only required teardown metadata fields.
- [x] 6.3 Generate and commit Drizzle migration for persistence changes using `bun run --cwd apps/web db:generate`.
- [x] 6.4 Update session creation UI with provider dropdown sourced from registry availability.
- [x] 6.5 Implement server-side fallback/unavailable-provider handling and capability-gated DB toggle behavior.

## 7. Local Development Bootstrap

- [x] 7.1 Add/maintain root `docker-compose.yml` for local development dependencies and provider-support services.
- [x] 7.2 Add sandbox image definitions and setup scripts for local provider workflows.
- [x] 7.3 Ensure local credential bootstrap is development-only and clearly documented as non-production.
- [x] 7.4 Document local development flow in a dedicated runbook (setup, env, verification).

## 8. Security and Hardening

- [x] 8.1 Implement credential-brokering or ephemeral auth paths that avoid persisting credential-bearing git remotes.
- [x] 8.2 Add secret-redaction tests for provider logs and failure paths.
- [x] 8.3 Add provider availability/fallback integration tests and unknown-provider handling tests.
- [x] 8.4 Add migration and backward-compatibility tests for legacy `cloud` sessions.
- [x] 8.5 Run and pass required repository checks with `bun run ci`.
