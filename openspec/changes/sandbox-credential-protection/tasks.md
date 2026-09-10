## Execution

**Before starting:** Invoke the `superpowers:subagent-driven-development` skill. Each task group should be dispatched to parallel subagents where dependencies allow.

**During implementation:** Follow red-green-refactor TDD — write a failing test first (red), implement the minimum code to pass it (green), then refactor. Do not skip the red phase.

**On completion:** Invoke the `review-implementation` skill before marking this change done.

---

Independent of the other Phase 1 changes; can land in parallel. Groups 1–2 must ship and
deploy before group 3 — that gap is the point of the expand-contract sequencing, not an
oversight.

## 1. Credential relocation (expand)

- [ ] 1.1 Inventory which fields in `user_sandbox_configs.config` are credentials versus non-secret settings, per provider (`vercel`, `docker`, `daytona`).
- [ ] 1.2 For providers whose credentials can be org-wide, declare them in `apps/web/lib/config/sandbox.ts` with axis + description; regenerate `.env.example` and commit.
- [ ] 1.3 For genuinely per-user credentials, add encryption at rest using the same AES-GCM helper that protects the Linear workspace token.
- [ ] 1.4 Make the read path resolve credentials from the new location, falling back to the old plaintext field while it still exists.
- [ ] 1.5 Make the write path store only to the new location.

## 2. Masked reads

- [ ] 2.1 Change the settings API response to return a boolean "credential set" indicator instead of the value.
- [ ] 2.2 Update `apps/web/app/settings/sandboxes` to render the masked indicator and a re-entry affordance.
- [ ] 2.3 Test that no endpoint returns a credential value to the client.

## 3. Plaintext removal (contract)

- [ ] 3.1 Migration removing credential fields from existing `config` payloads.
- [ ] 3.2 Remove the plaintext fallback from the read path.
- [ ] 3.3 Detect users whose credential was removed and prompt re-entry rather than failing provisioning silently.

## 4. Verification

- [ ] 4.1 Test: saving provider settings persists no plaintext credential.
- [ ] 4.2 Test: sandbox provisioning still succeeds for each provider after relocation.
- [ ] 4.3 Test: during the expand window, a deployment reading the old field and one reading the new field both resolve credentials.
- [ ] 4.4 `SECURITY.md` note on the closed hole.
- [ ] 4.5 `bun run ci` green.
