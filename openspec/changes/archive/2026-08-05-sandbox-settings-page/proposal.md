## Why

Users have no UI surface to configure sandbox providers — today they rely on raw environment variables set outside the app. As the provider list grows (Vercel, Docker, Daytona), discoverability, configuration, and per-user control need a first-class settings page so users can enable, configure, and switch providers without touching env vars or redeploying.

## What Changes

- Add a **Settings** section to the app navigation
- Add a **Sandboxes** settings page under Settings
- Each sandbox provider is represented as a card with an enable/disable toggle
- Toggling a provider on expands a configuration form specific to that provider (API keys, base image, team slug, etc.)
- When a provider is fully configured, its card enters a "configured" state showing a green status indicator and a Settings button to re-open the edit modal
- Providers that are structurally unavailable in the current environment (e.g. Docker when not in `NODE_ENV=development`) are shown as disabled and non-toggleable
- Enabled + configured providers become selectable in the session creation flow
- A **default sandbox** picker at the top of the Sandboxes page lets users choose which provider is pre-selected when starting a new session (populates from enabled providers only)
- The existing sandbox-type selector in the new-session flow is driven by the same enabled-providers list

## Capabilities

### New Capabilities

- `sandbox-provider-settings`: Per-provider configuration cards — toggle enable/disable, fill in provider-specific fields, persist config, show configured/unconfigured status
- `default-sandbox-preference`: User-level preference for which sandbox provider is the default, surfaced as a picker on the Sandboxes settings page and consumed by the session creation flow

### Modified Capabilities

<!-- none — no existing specs to delta -->

## Impact

- **New routes**: `apps/web/app/settings/` layout + `apps/web/app/settings/sandboxes/` page
- **New API endpoints**: `GET/PATCH /api/settings/sandbox-providers` to read/write per-provider config (stored in DB as user settings or encrypted env-like records)
- **DB schema**: New table or JSON column for storing provider config per user (API keys, toggles, default preference)
- **Sandbox registry**: `isAvailable()` must reflect both structural availability (env/platform) and user-enabled state
- **Session creation UI**: Provider dropdown populated from enabled+configured providers
- **Existing sandbox selector**: Replaced or augmented by the preference from the settings page
