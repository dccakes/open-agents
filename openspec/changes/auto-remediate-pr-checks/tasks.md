## 1. Data Model and State

- [ ] 1.1 Add remediation tracking schema fields/tables for session+PR+head SHA attempt state, fingerprint, and timestamps.
- [ ] 1.2 Add DB access helpers for watcher lease claim/release and remediation state read/write.
- [ ] 1.3 Generate and commit migration for remediation persistence changes.

## 2. Shared Remediation Packaging

- [ ] 2.1 Extract failing-check prompt/snippet packaging into a shared service callable by manual and automatic paths.
- [ ] 2.2 Refactor manual `/checks/fix` route to use the shared packaging service without behavior regression.
- [ ] 2.3 Add tests for packaging fallback behavior when logs or annotations are unavailable.

## 3. Watcher Workflow

- [ ] 3.1 Implement durable PR watcher workflow with single-lease enforcement per session.
- [ ] 3.2 Implement evaluation step that resolves check readiness for the tracked PR/head SHA.
- [ ] 3.3 Implement terminal-state handling and watcher shutdown on PR closed/merged.
- [ ] 3.4 Add polling fallback schedule when webhook events are delayed or missing.

## 4. Webhook Event Ingestion

- [ ] 4.1 Extend GitHub webhook route to process `check_run`, `check_suite`, and `workflow_run` events for tracked PRs.
- [ ] 4.2 Add idempotency guard for duplicate GitHub deliveries.
- [ ] 4.3 Trigger watcher evaluation from correlated webhook events.

## 5. Automatic Remediation Execution

- [ ] 5.1 Implement synthetic remediation message injection into active chat history.
- [ ] 5.2 Trigger chat workflow execution for remediation through existing run orchestration APIs.
- [ ] 5.3 Implement post-remediation reevaluation handoff back to watcher loop.

## 6. Safety Controls

- [ ] 6.1 Enforce max-attempt budget per head SHA.
- [ ] 6.2 Enforce cooldown window between attempts.
- [ ] 6.3 Implement failure fingerprint computation and unchanged-fingerprint dedupe.
- [ ] 6.4 Ensure safety policies cancel pending retries when PR reaches terminal state.

## 7. Observability and Validation

- [ ] 7.1 Emit structured logs for watcher lifecycle, trigger decisions, and safety stops.
- [ ] 7.2 Add integration tests for webhook-driven remediation triggering and dedupe/budget behavior.
- [ ] 7.3 Add tests that verify single active watcher lease semantics under concurrent triggers.
- [ ] 7.4 Run and pass required repository checks with `bun run ci`.
