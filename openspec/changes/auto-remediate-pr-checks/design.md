## Context

The system already supports auto-commit, auto-PR creation, and manual check remediation. Check evaluation exists (`merge-readiness`) and failure context extraction exists (`checks/fix`), but remediation is still user-triggered. We need automatic follow-through so PRs are self-healing within safe limits.

## Goals / Non-Goals

**Goals:**
- Automatically monitor PR checks after PR creation and relevant GitHub events.
- Trigger automated remediation when checks fail without user interaction.
- Reuse existing check-log extraction quality while moving orchestration server-side.
- Prevent infinite loops via strong safety controls.
- Persist enough remediation state for visibility and deterministic behavior.

**Non-Goals:**
- Replacing manual "Fix errors" UX.
- Autonomous merge after checks pass.
- Supporting non-GitHub CI providers in this change.
- Unlimited autonomous retries.

## Decisions

### 1. Durable watcher workflow with webhook-first, poll-fallback evaluation
- Decision: Use a durable watcher per session/PR with single-lease ownership. Webhook events trigger immediate evaluation; periodic polling backs up missed/delayed events.
- Rationale: Webhooks provide low latency; polling provides resilience.
- Alternative: Poll-only.
- Why rejected: Slower feedback and higher API cost.

### 2. Server-side remediation trigger via synthetic chat message injection
- Decision: When failing checks are detected, build remediation payload (prompt + snippets) and inject a synthetic user-intent message into the active chat, then start the normal chat workflow path.
- Rationale: Reuses existing agent behavior and keeps a consistent repair loop.
- Alternative: Execute remediation as out-of-band tool call.
- Why rejected: Harder to keep observable in chat history and harder to reuse existing flow control.

### 3. Failure fingerprint dedupe keyed by head SHA + failing signature
- Decision: Compute and persist a fingerprint from head SHA + failing check identifiers/outcomes, and skip retries for unchanged fingerprints.
- Rationale: Prevents repeated attempts on unchanged failures.
- Alternative: Time-only cooldown.
- Why rejected: Cooldown alone still allows repeated no-op loops.

### 4. Hard safety policy defaults
- Decision: Default max attempts = 3 per head SHA, cooldown between attempts, one active watcher lease per session, stop on PR closed/merged.
- Rationale: Fully automatic mode requires deterministic safety limits.
- Alternative: Unlimited retries with heuristic stop.
- Why rejected: Unbounded cost and noisy behavior.

### 5. Shared remediation service for both manual and automatic paths
- Decision: Extract/centralize check-log packaging logic so manual button flow and auto-remediation call the same service API.
- Rationale: Reduces drift and keeps output quality consistent.
- Alternative: Duplicate auto-remediation implementation.
- Why rejected: Maintenance risk and inconsistent prompts.

## Risks / Trade-offs

- [Runaway automation loop] → Mitigation: attempt budgets, cooldown, fingerprint dedupe, terminal-state stop.
- [Webhook delivery gaps] → Mitigation: fallback polling and idempotent evaluation.
- [Insufficient log access permissions] → Mitigation: degrade to minimal failure prompt when logs/annotations unavailable.
- [Concurrent workflow conflicts] → Mitigation: enforce single active watcher lease and chat stream ownership checks.
- [API rate pressure] → Mitigation: webhook-first strategy, bounded polling intervals, and deduped reevaluations.

## Migration Plan

1. Add remediation state persistence schema and migration.
2. Implement shared remediation packaging service from existing checks/fix logic.
3. Add watcher workflow + lease and evaluation trigger APIs.
4. Extend GitHub webhook ingestion for check-related events.
5. Hook auto-PR success path to start watcher.
6. Roll out with conservative defaults and monitoring.

Rollback strategy:
- Disable auto-remediation trigger via configuration while preserving manual fix path.
- Keep watcher disabled but leave state fields inert.

## Open Questions

- Should default cooldown be fixed globally or per-repo configurable?
- Should infrastructure-failure check classes (e.g., flaky external services) be excluded from auto-fix attempts by default?
- Should we expose watcher/remediation status explicitly in Git panel UI in phase 1 or phase 2?
