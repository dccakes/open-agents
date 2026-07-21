## Context

The app already has a `/settings/preferences` page with a basic `SandboxSelectorCompact` that lets users pick a default sandbox type (Vercel / Docker / Daytona). However, providers have no first-class configuration surface — API keys, base image, team slugs and other provider-specific values must be set as raw environment variables outside the app.

As the provider list grows, this creates friction: users must know which env vars each provider needs, there is no per-user config, and there is no way to signal "this provider is ready to use" vs "this provider is available structurally but not yet configured."

This design adds a dedicated **Sandboxes** page under Settings that owns the full provider lifecycle: enable → configure → use.

## Goals / Non-Goals

**Goals:**
- One settings page that shows all sandbox providers as cards
- Per-card toggle (enable/disable), config form, and configured/unconfigured status indicator
- Provider config persisted per-user in the database
- Default sandbox picker on the same page, driven by enabled+configured providers
- Structurally unavailable providers (e.g. Docker in production) shown as non-toggleable
- Enabled+configured providers appear in the session-creation dropdown

**Non-Goals:**
- Encrypting sensitive values in DB at MVP (noted as a follow-up)
- Replacing the existing `/settings/preferences` sandbox selector immediately (kept for backwards compat; can be deprecated in a follow-up)
- Managing env vars on behalf of the user (the UI stores config in DB, not the host env)
- Supporting custom/third-party providers not already in the registry

## Decisions

### 1. Where to store provider config

**Decision:** New `userSandboxConfigs` table with columns `userId`, `providerType`, `enabled` (boolean), `config` (JSONB). One row per user per provider.

**Rationale:** Provider config is user-scoped and provider-specific. Adding columns to `userPreferences` would require schema changes for every new provider. A dedicated table with a JSONB `config` column lets each provider own its own shape without schema migrations per provider.

**Alternative considered:** Storing as encrypted env vars in a secrets table — rejected because it conflates "what the user configured" with "what the runtime sees"; the current provider implementations already read from `process.env`, so we keep that path for structural availability while adding DB-backed user config as a complement.

### 2. How provider-specific fields are declared

**Decision:** Extend `SandboxProviderDef` with an optional `configFields: SandboxConfigField[]` array. Each field has `key`, `label`, `type` (`text | url | password`), `required`, and `placeholder`. The settings UI renders these generically — no per-provider UI components needed.

**Rationale:** Keeps provider knowledge in the provider package (single source of truth) and lets the settings UI be fully generic. Adding a new provider automatically produces the right form.

**Alternative considered:** Hard-coding per-provider forms in the UI — rejected as it creates tight coupling and requires a UI change every time a provider is added or a field changes.

### 3. Availability model: structural vs user-enabled

**Decision:** Two separate layers:
- **Structural availability** (`provider.isAvailable()`) — determined by platform/env. Docker is `false` in production. Vercel is `false` without credentials. Cannot be overridden by the user.
- **User-enabled** (`userSandboxConfigs.enabled`) — set by the user via the toggle. Only meaningful when structurally available.

A provider is "selectable" in the session flow only when both layers are true AND config is present.

**Rationale:** Prevents users from enabling Docker in a deployed environment or Daytona without the required env vars, while still letting users opt out of structurally available providers they don't want to use.

### 4. Default sandbox preference

**Decision:** Add a `defaultSandboxType` picker at the top of the Sandboxes settings page. Persist to the existing `userPreferences.defaultSandboxType` column. Keep the `/settings/preferences` selector in place but mark it as superseded in a future cleanup.

**Rationale:** Reusing the existing column avoids a migration and keeps the existing session-creation flow working without changes. The Sandboxes page becomes the canonical place to change the default, but the underlying storage doesn't move.

### 5. Sensitive field handling at MVP

**Decision:** Store API keys and other sensitive fields as plaintext JSONB in `userSandboxConfigs.config`. Add a `TODO` comment noting that encryption (e.g. field-level AES or KMS-backed secret refs) is required before this is production-ready for multi-tenant use.

**Rationale:** Unblocks the feature without infrastructure complexity. Single-tenant / self-hosted deployments are the primary use-case for custom API keys at this stage.

## Risks / Trade-offs

- **Sensitive values in DB** → Mitigation: document clearly, add TODO, scope initial rollout to trusted environments. Plan field-level encryption as a follow-up.
- **Config in DB vs process.env divergence** → Provider implementations still read `process.env` for structural checks; user config from DB is layered on top. If the same key appears in both, DB wins for the session being created. Mitigation: document the precedence clearly in the provider README.
- **Per-provider configFields maintenance** → If a provider adds a field without updating `configFields`, the UI won't show it. Mitigation: the providers README documents this requirement; CI can lint for it.
- **Default sandbox becomes stale** → If the user's default provider is later disabled or becomes structurally unavailable, sessions would fall back silently. Mitigation: validate default on page load and surface a warning if the current default is no longer selectable.

## Open Questions

- Should the Sandboxes page be accessible to all users or gated to a role (e.g. admin for multi-user deployments)?
- Should per-session env vars (currently passed via `ConnectOptions.env`) be injectable from the Sandboxes config, or stay session-scoped only?
