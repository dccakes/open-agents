## ADDED Requirements

### Requirement: Every shared-configuration mutation is audited
The system SHALL record an append-only `config_audit` entry for every mutation of shared organization configuration — org settings, membership and role changes, integration connect/disconnect/restore, provider enablement, and observability configuration. Each entry SHALL identify the actor user, the organization, the action, the target type and id, a summary of the previous and new values, and the timestamp.

#### Scenario: Audited mutation succeeds
- **WHEN** an admin changes any shared configuration value
- **THEN** a `config_audit` row exists with the actor, organization, action, target, before/after summary, and timestamp

### Requirement: The audit guarantee is transactional for app-owned mutations and best-effort for plugin-mediated ones
For mutations this application performs directly — org settings, integration lifecycle, provider enablement, observability configuration — the audit write SHALL occur in the same transaction as the mutation, so such a mutation cannot succeed unaudited. For mutations performed through Better Auth's plugin APIs — membership approval, role change, member removal — the audit write SHALL be performed from the plugin's after-hooks on a best-effort basis, and a failure to write SHALL be reported to the error tracker rather than swallowed. Documentation SHALL state which guarantee applies where.

#### Scenario: Audit write fails during an app-owned mutation
- **WHEN** the audit insert fails while changing org settings or an integration
- **THEN** the mutation is rolled back and the configuration is unchanged

#### Scenario: Plugin-mediated membership change is audited
- **WHEN** an admin approves a pending user or changes a member's role through the plugin API
- **THEN** an audit row is written from the corresponding after-hook

#### Scenario: Audit write fails during a plugin-mediated mutation
- **WHEN** the after-hook audit insert fails after the plugin has committed the membership change
- **THEN** the membership change stands, the failure is reported to the error tracker, and the system does not claim the mutation was rolled back

#### Scenario: Audit records are not modifiable
- **WHEN** any code path attempts to update or delete an existing `config_audit` row
- **THEN** no such path exists in the application; the table is written by insert only

#### Scenario: Secrets are not written to the audit trail
- **WHEN** a mutation changes a value that holds a credential or secret
- **THEN** the audit entry records that the value changed without recording the secret value itself

### Requirement: Destructive shared-config actions require typed confirmation
The system SHALL require the user to type an exact confirmation string identifying the target before executing a destructive action on shared configuration — disconnecting the Linear workspace, removing an organization-shared GitHub installation, or deleting a repo mapping.

#### Scenario: Confirmation string does not match
- **WHEN** an admin submits a destructive action with a confirmation string that does not match the target identifier
- **THEN** the action is refused and nothing is deleted

#### Scenario: Confirmation string matches
- **WHEN** an admin submits a destructive action with the exact confirmation string
- **THEN** the action proceeds as a soft delete and an audit record is written

### Requirement: Destructive shared-config actions are soft deletes
Destructive actions on shared configuration SHALL set a `deletedAt` timestamp and disable the record rather than removing the row. A soft-deleted record SHALL be excluded from all normal read paths and SHALL behave as absent to consumers.

#### Scenario: Soft-deleted integration is inert
- **WHEN** an integration has been soft-deleted
- **THEN** connection status reports it as not connected and no feature consumes it

#### Scenario: Row is retained
- **WHEN** an integration has been soft-deleted
- **THEN** the underlying row still exists with `deletedAt` set

### Requirement: Soft-deleted shared config can be restored within the retention window
A user holding the permission required to delete a record SHALL be able to restore it while it remains within the 14-day retention window, and the restored record SHALL be fully functional — including webhook signature verification for restored integrations.

#### Scenario: Restore within the window
- **WHEN** an admin restores an integration soft-deleted three days earlier
- **THEN** `deletedAt` is cleared, the integration is reported as connected, an audit record is written, and inbound webhooks for it verify successfully

#### Scenario: Restore after the window
- **WHEN** an admin attempts to restore a record that has already been purged
- **THEN** the restore fails with a clear message that the retention window has elapsed

### Requirement: The purge job runs only in production
The system SHALL provide a scheduled handler that permanently removes soft-deleted shared-configuration records older than 14 days. The handler SHALL return without performing any deletion unless `VERCEL_ENV` is `production`.

#### Scenario: Purge runs in a preview environment
- **WHEN** the purge handler is invoked with `VERCEL_ENV` set to `preview`
- **THEN** it returns immediately, deletes nothing, and reports that it was skipped

#### Scenario: Purge runs in production
- **WHEN** the purge handler is invoked in production
- **THEN** soft-deleted records older than 14 days are permanently removed and records within the window are retained

#### Scenario: Purge boundary
- **WHEN** a record was soft-deleted exactly 14 days ago
- **THEN** it is retained; only records older than the window are purged
