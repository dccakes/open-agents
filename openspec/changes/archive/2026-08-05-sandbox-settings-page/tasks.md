## 1. Data Layer — DB schema & migrations

- [x] 1.1 Add `userSandboxConfigs` table to `apps/web/lib/db/schema.ts` with columns: `id`, `userId` (FK), `providerType` (enum), `enabled` (boolean, default false), `config` (JSONB, default `{}`), `createdAt`, `updatedAt`
- [x] 1.2 Run `bun run --cwd apps/web db:generate` and commit the generated migration file
- [x] 1.3 Add DB accessor helpers in `apps/web/lib/db/sandbox-configs.ts`: `getUserSandboxConfigs(userId)`, `upsertUserSandboxConfig(userId, providerType, patch)`

## 2. Provider registry — configFields extension

- [x] 2.1 Add `SandboxConfigField` type to `packages/sandbox/provider.ts` with fields: `key`, `label`, `type` (`"text" | "url" | "password"`), `required`, `placeholder?`
- [x] 2.2 Add optional `configFields?: SandboxConfigField[]` to `SandboxProviderDef`
- [x] 2.3 Add `configFields` to the Vercel provider (`packages/sandbox/providers/vercel/index.ts`): `VERCEL_SANDBOX_BASE_SNAPSHOT_ID` (optional), `VERCEL_TEAM` (optional), `VERCEL_PROJECT` (optional)
- [x] 2.4 Add `configFields` to the Docker provider (`packages/sandbox/providers/docker/index.ts`): `DOCKER_SANDBOX_IMAGE` (required)
- [x] 2.5 Add `configFields` to the Daytona provider (`packages/sandbox/providers/daytona/index.ts`): `DAYTONA_SERVER_URL` (required, url), `DAYTONA_API_KEY` (required, password)

## 3. Settings API

- [x] 3.1 Create `GET /api/settings/sandbox-providers/route.ts` — returns all registered providers with structural availability, user-enabled state, and non-sensitive config fields for the authenticated user
- [x] 3.2 Create `PATCH /api/settings/sandbox-providers/[providerType]/route.ts` — upserts `userSandboxConfigs` row for the authenticated user; validates `providerType` is in the registry
- [x] 3.3 Add auth guard (`requireAuthenticatedUser`) to both endpoints

## 4. Settings navigation

- [x] 4.1 Create `apps/web/app/settings/sandboxes/` directory with `page.tsx` and necessary layout wiring
- [x] 4.2 Add "Sandboxes" nav item to the Settings sidebar (update `apps/web/app/settings/layout.tsx` or equivalent nav config)

## 5. Sandboxes page — provider cards UI

- [x] 5.1 Create `apps/web/components/settings/sandbox-provider-card.tsx` — card component accepting provider metadata + user config; renders toggle, status indicator (grey/red/green dot), provider name and logo
- [x] 5.2 Create `apps/web/components/settings/sandbox-config-form.tsx` — generic form that renders fields from `provider.configFields`; handles password masking for existing values
- [x] 5.3 Create `apps/web/components/settings/sandbox-config-modal.tsx` — modal wrapper around `SandboxConfigForm` for re-editing a configured provider
- [x] 5.4 Wire `SandboxProviderCard` to toggle endpoint (`PATCH /api/settings/sandbox-providers/[type]`) on toggle change
- [x] 5.5 Wire `SandboxConfigForm` save to `PATCH /api/settings/sandbox-providers/[type]` with config payload; show inline validation errors
- [x] 5.6 Implement configured/unconfigured detection: a provider is "configured" when all `required` fields in `configFields` are present in saved config
- [x] 5.7 Build the Sandboxes page (`page.tsx`): fetch providers from `GET /api/settings/sandbox-providers`, render a card for each, handle loading/error states

## 6. Default sandbox picker

- [x] 6.1 Create `apps/web/components/settings/default-sandbox-picker.tsx` — dropdown/select populated from enabled+configured providers; calls `PATCH /api/settings/user-preferences` on change (reusing existing preferences endpoint)
- [x] 6.2 Mount `DefaultSandboxPicker` at the top of the Sandboxes settings page
- [x] 6.3 Add warning banner on Sandboxes page when `userPreferences.defaultSandboxType` refers to a provider that is no longer enabled/configured

## 7. Session creation — driven by enabled providers

- [x] 7.1 Update `GET /api/settings/sandbox-providers` response to include an `isConfigured` boolean per provider
- [x] 7.2 Update the session creation sandbox selector to fetch from `/api/settings/sandbox-providers` and filter to `isAvailable && enabled && isConfigured`
- [x] 7.3 Pre-select `userPreferences.defaultSandboxType` in the session creation dropdown if it is in the filtered list; otherwise pre-select the first available option
- [x] 7.4 Show a "Configure sandboxes" link in the session creation dropdown when zero providers are configured

## 8. Preferences page cleanup

- [x] 8.1 Replace the `SandboxSelectorCompact` widget on `/settings/preferences` with a read-only display of the current default provider name + a "Manage sandboxes →" link to `/settings/sandboxes`

## 9. Tests & CI

- [x] 9.1 Add unit tests for `getUserSandboxConfigs` and `upsertUserSandboxConfig` DB helpers
- [x] 9.2 Add API route tests for `GET /api/settings/sandbox-providers` (auth guard, correct shape)
- [x] 9.3 Add API route tests for `PATCH /api/settings/sandbox-providers/[type]` (upsert, unknown type 404)
- [x] 9.4 Run `bun run ci` and confirm all checks pass
