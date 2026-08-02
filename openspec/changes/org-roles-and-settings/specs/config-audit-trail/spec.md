## ADDED Requirements

### Requirement: Every shared-configuration mutation is audited
The system SHALL record an append-only `config_audit` entry for every mutation of shared organization configuration — org settings, membership and role changes, integration connect/disconnect/restore, provider enablement, and observability configuration. Each entry SHALL identify the actor user, the organization, the action, the target type and id, a summary of the previous and new values, and the timestamp. The audit write SHALL occur in the same transaction as the mutation.

#### Scenario: Audited mutation succeeds
- **WHEN** an admin changes any shared configuration value
- **THEN** a `config_audit` row exists with the actor, organization, action, target, before/after summary, and timestamp

#### Scenario: Audit write fails
- **WHEN** the audit insert fails during a shared-configuration mutation
- **THEN** the mutation is rolled back and the configuration is unchanged, so no mutation can succeed unaudited

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
