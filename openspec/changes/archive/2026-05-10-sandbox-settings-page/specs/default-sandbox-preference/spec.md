## ADDED Requirements

### Requirement: Default sandbox picker on Sandboxes settings page
The Sandboxes settings page SHALL display a "Default sandbox" picker at the top of the page. The picker SHALL be populated only with providers that are currently enabled and fully configured.

#### Scenario: No providers are enabled
- **WHEN** no providers are enabled and configured
- **THEN** the default sandbox picker is disabled and shows a placeholder "No providers configured"

#### Scenario: One or more providers are enabled and configured
- **WHEN** at least one provider is enabled and configured
- **THEN** the default sandbox picker lists those providers by label and the currently saved default is pre-selected

#### Scenario: User selects a new default
- **WHEN** the user selects a different provider in the default sandbox picker
- **THEN** `userPreferences.defaultSandboxType` is updated and the selection is persisted immediately (no separate Save button)

---

### Requirement: Default sandbox picker reflects provider state changes
The default sandbox picker SHALL update reactively when providers are enabled, disabled, or configured.

#### Scenario: Currently-default provider is disabled
- **WHEN** the user disables a provider that is currently set as the default
- **THEN** the default sandbox picker clears the selection and shows a warning that no default is set, prompting the user to choose another

#### Scenario: New provider becomes configured
- **WHEN** a provider transitions to the configured state
- **THEN** it becomes available in the default sandbox picker without requiring a page reload

---

### Requirement: Session creation dropdown uses enabled providers
The session creation flow SHALL populate its sandbox type selector with only the providers that are enabled, configured, and structurally available at the time the dialog is opened.

#### Scenario: Only enabled+configured providers appear
- **WHEN** the user opens the new session dialog
- **THEN** the sandbox type dropdown contains only providers where `isAvailable()` is true AND the user has enabled and configured them

#### Scenario: Pre-selected value matches default preference
- **WHEN** the new session dialog opens
- **THEN** the sandbox type dropdown pre-selects `userPreferences.defaultSandboxType` if that provider is in the available list; otherwise the first available provider is selected

#### Scenario: No configured providers
- **WHEN** no providers are enabled and configured
- **THEN** the session creation flow falls back to the system default (Vercel if available) and shows a link to configure providers in Settings

---

### Requirement: Sandboxes settings page replaces sandbox selector in preferences
The sandbox type selector previously shown on `/settings/preferences` SHALL be removed from that page and replaced with a link to `/settings/sandboxes`.

#### Scenario: User visits preferences page
- **WHEN** the user navigates to `/settings/preferences`
- **THEN** the sandbox section shows the currently active default provider name and a "Manage sandboxes" link that navigates to `/settings/sandboxes`
