## Why

Pull requests created by the agent still require manual monitoring of checks and manual triggering of "Fix errors." This slows iteration and leaves sessions stalled on failing CI even though the system already knows how to collect logs and generate a targeted fix prompt.

## What Changes

- Add a fully automatic PR check watcher that tracks PR status after PR creation and on relevant GitHub webhook events.
- Add webhook ingestion for check-related events to trigger immediate re-evaluation of check outcomes.
- Automatically collect failing check annotations/logs and submit a synthetic remediation message to the agent when checks fail.
- Add safety controls (attempt budget, cooldown, fingerprint dedupe, single active watcher lease) to prevent remediation loops.
- Add persistence and telemetry for remediation lifecycle state per session/PR/head SHA.
- Keep existing manual "Fix errors" behavior available as a fallback path.

## Capabilities

### New Capabilities
- `pr-check-watcher`: Durable lifecycle for tracking PR check outcomes until pass/terminal state.
- `pr-check-event-ingestion`: Webhook-driven event ingestion for PR/check updates with idempotent session correlation.
- `auto-pr-check-remediation`: Zero-click failure remediation that packages logs and asks the agent to fix failing checks.
- `pr-remediation-safety-controls`: Loop prevention policies for fully automatic remediation.
- `pr-remediation-observability`: Persistent remediation status and audit signals for debugging and support.

### Modified Capabilities
- None.

## Impact

- Affected systems: GitHub webhook handling, chat workflow orchestration, session/chat persistence, merge-readiness/check inspection flow.
- Likely code areas: `apps/web/app/api/github/webhook`, `apps/web/app/workflows/*`, `apps/web/lib/github/client`, session/chat DB access modules.
- Data model impact: remediation tracking fields and/or new remediation run records tied to session + PR + head SHA.
- Runtime impact: new background watcher workflow(s) and event-triggered evaluations.
