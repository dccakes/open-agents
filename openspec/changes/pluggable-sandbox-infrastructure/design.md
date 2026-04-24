## Context

The current sandbox implementation is effectively single-provider: runtime creation and reconnection paths are tightly coupled to Vercel sandbox infrastructure. This limits local development, prevents provider-specific capability growth, and makes future provider additions expensive. The proposed change introduces a provider registry and capability model while preserving the core `Sandbox` runtime contract to reduce migration risk.

A reviewed fork validates that Daytona integration is feasible and that local Docker Compose can bootstrap supporting services, but it also highlights gaps we must address in this change: hardcoded provider branching, lack of provider availability gating, and credential persistence risks in git remotes.

## Goals / Non-Goals

**Goals:**
- Introduce a provider registry that supports provider-typed create/connect lifecycle operations.
- Deliver a production-safe migration path from legacy `cloud` provider state to `vercel`.
- Ship a secured Daytona beta provider (pause/resume + preview URL mapping) through the same provider contract.
- Enable local sandbox development through a true Docker provider with predictable lifecycle semantics.
- Support session-time provider selection, availability-based fallback, and optional database provisioning.
- Re-enable secure environment variable injection through a resolver abstraction with backend selection.
- Define and implement session-scoped database provisioning for both cloud and local providers.

**Non-Goals:**
- Full Daytona production hardening beyond beta scope.
- Upstash Box support in this change.
- Redesign of agent runtime protocol.
- Allowing credential-bearing git remote URLs to persist in sandbox workspaces.

## Decisions

### 1. Keep the runtime contract; add registry + availability model
- Decision: Introduce `SandboxProvider` metadata and lifecycle methods without rewriting the core sandbox command/file API.
- Rationale: Preserves compatibility while enabling provider extension via composition.
- Alternative considered: provider-specific runtime interfaces.
- Why rejected: Large migration blast radius.

### 2. Capability + availability gating
- Decision: Every provider declares capabilities (`db`, `envInjection`, `persistent`, `credentialBrokering`) and availability (`isAvailable`, `reasonUnavailable`), and UI/API behavior is gated by both.
- Rationale: Prevents unsupported or misconfigured providers from entering user flows.
- Alternative considered: hardcoded provider-specific checks.
- Why rejected: reintroduces lock-in and branching sprawl.

### 3. Phase implementation to separate infra from runtime providers
- Decision: Explicitly separate Docker Compose support infrastructure from Docker sandbox provider runtime implementation.
- Rationale: Avoids conflating “runs with Docker locally” with “Docker provider exists in registry.”
- Alternative considered: treat compose stack as equivalent to Docker provider.
- Why rejected: obscures scope and leaves provider contract unimplemented.

### 4. Secure credential handling across providers
- Decision: Provider implementations must use credential brokering or ephemeral auth mechanisms and must not persist credential-bearing git remotes; sensitive data must be redacted from logs.
- Rationale: Prevents token leakage and hard-to-audit credential exposure.
- Alternative considered: convenience URL-token remotes.
- Why rejected: unacceptable secret persistence risk.

### 5. Provider-agnostic preview and hibernation semantics
- Decision: Standardize preview URL resolution as an async provider operation and support optional `pause()` semantics for persistent providers.
- Rationale: Some providers (e.g., Daytona) resolve preview links asynchronously and support archive/resume behavior.
- Alternative considered: synchronous `domain(port)` assumption and stop-only lifecycle.
- Why rejected: incompatible with multi-provider behavior.

### 6. Optional DB provisioning with provider-specific implementations
- Decision: Add explicit `provisionDb` session option and route provisioning through a shared interface with Neon and Docker implementations.
- Rationale: Predictable opt-in behavior with provider-tailored lifecycle.
- Alternative considered: always provision DB.
- Why rejected: unnecessary cost/complexity.

### 7. Session provider identity stored in existing session sandbox state
- Decision: Persist active provider identity primarily via session sandbox state type and use dedicated columns only for additional teardown metadata when required.
- Rationale: Aligns provider selection and runtime reconnect source of truth.
- Alternative considered: separate mandatory `sandboxProvider` column for all reads/writes.
- Why rejected: duplicates state and increases migration complexity.

## Risks / Trade-offs

- [Registry/API drift] Provider metadata and runtime behavior can diverge. → Mitigation: typed provider contract + integration tests per provider.
- [Secret leakage risk] Misconfigured resolver/backend or provider auth path may expose secrets. → Mitigation: denylist enforcement, redaction tests, and no credential-bearing remote persistence.
- [Provisioning lifecycle leaks] DB resources may remain after failed teardown. → Mitigation: store teardown identifiers and run best-effort cleanup on session termination.
- [Operational variance] Docker/Daytona behavior differs from cloud Vercel behavior. → Mitigation: capability/availability flags + documented provider semantics.
- [Local stack complexity] Daytona local bootstrap requires privileged services and generated credentials. → Mitigation: local-only profile guardrails and setup script checks.
- [Migration regressions] Legacy `cloud` session reconnects can break. → Mitigation: one-time migration + runtime alias fallback.

## Migration Plan

1. Add/confirm provider identity persistence via sandbox state and add only required teardown metadata fields.
2. Generate and apply migration, including data transform from `cloud` to `vercel` where needed.
3. Deploy provider registry with Vercel provider first behind compatibility mapping.
4. Enable Daytona beta provider with availability gating and credential-safety constraints.
5. Enable Docker provider runtime and session configuration UI/API updates.
6. Enable env resolver and DB provisioner paths with staged rollout controls.
7. Validate teardown, migration, and secret-handling behavior in preview before production rollout.

Rollback strategy:
- Disable non-Vercel providers and env/db optional flows via configuration.
- Keep alias handling for legacy provider values during rollback window.
- Revert provider-selection reads before reverting schema-affecting migrations.

## Open Questions

- Should Daytona remain beta-only and disabled by default in production initially?
- Should provider fallback prefer `vercel` or `docker` when preferred provider is unavailable?
- Which credential-brokering approach is approved for non-Vercel providers (helper vs broker service)?
- Should local Daytona compose be default local dev path or opt-in profile?
