## Purpose

Makes a GitHub App installation on a shared GitHub account a resource the organization owns, so any approved member resolves the same installation, rather than a per-person record that only the teammate who synced it can use.

## ADDED Requirements

### Requirement: Installations on allowlisted GitHub accounts are owned by the organization

The system SHALL maintain an organization-level allowlist of GitHub accounts, keyed by GitHub's immutable numeric account identifier. An installation whose account identifier appears on the allowlist SHALL be owned by the organization and represented by exactly one record per installation. Every other installation SHALL remain personal to the user who installed it.

#### Scenario: Installation on an allowlisted account

- **WHEN** the GitHub App is installed on an account whose identifier is on the organization allowlist
- **THEN** the installation is recorded as organization-owned, with exactly one record for that installation

#### Scenario: Installation on an account that is not allowlisted

- **WHEN** the GitHub App is installed on an account whose identifier is not on the allowlist
- **THEN** the installation is recorded as personal to the installing user and is not resolvable by other members

#### Scenario: The allowlisted account is renamed on GitHub

- **WHEN** an allowlisted GitHub account changes its login and a subsequent installation event or sync is processed
- **THEN** the installation remains organization-owned, and the stored login is updated to the new value

#### Scenario: Reinstalling the App on an allowlisted account

- **WHEN** the App is uninstalled from an allowlisted account and installed again, producing a new installation identifier
- **THEN** the new installation is organization-owned without any further administrative action

### Requirement: Personal GitHub user accounts cannot be allowlisted

The system SHALL reject any attempt to add a GitHub account of type `User` to the organization allowlist, and SHALL NOT treat an installation on a personal user account as organization-owned under any configuration.

#### Scenario: Admin attempts to allowlist a personal account

- **WHEN** an admin submits a GitHub account of type `User` to the allowlist
- **THEN** the request is rejected with an explanatory error and the allowlist is unchanged

### Requirement: Organization-owned installations resolve without a caller identity

The system SHALL resolve an organization-owned installation for a repository owner using the organization alone, without reference to which member is asking. Every approved member SHALL resolve the same installation record for the same repository owner.

#### Scenario: Member who never synced installations acts on an org repository

- **WHEN** an approved member who has no personal installation record requests an action on a repository covered by an organization-owned installation, and that member can access the repository on GitHub at the required permission
- **THEN** the installation resolves and the action proceeds

#### Scenario: Two members resolve the same installation

- **WHEN** two different approved members resolve the installation for the same repository owner
- **THEN** both resolve the same installation record

### Requirement: Repository authorization remains the caller's own GitHub access

The system SHALL verify that the requesting user's own GitHub credentials can access the repository at the permission the action requires, before and independently of resolving any installation. Organization ownership of an installation SHALL NOT grant a member access to a repository their own GitHub credentials cannot reach.

#### Scenario: Member cannot see the repository on GitHub

- **WHEN** an approved member requests an action on a repository their own GitHub credentials cannot access, and an organization-owned installation covers that repository
- **THEN** the request is denied for lack of user access, and no installation token is minted

#### Scenario: Member has read but not write access

- **WHEN** an approved member requests an action requiring write access to a repository where their own GitHub credentials grant only read access
- **THEN** the request is denied for insufficient user permission, regardless of the installation's permissions

#### Scenario: Member has no linked GitHub credentials

- **WHEN** a member with no linked GitHub account requests an action on a repository covered by an organization-owned installation
- **THEN** the request is denied and the member is prompted to connect GitHub

#### Scenario: Installation token scope is unchanged

- **WHEN** an action proceeds against an organization-owned installation
- **THEN** the minted installation token is scoped to the single repository being acted upon

### Requirement: Promotion and demotion are explicit, permissioned, and reversible

The system SHALL require the `integration.connect` permission to add a GitHub account to the allowlist and the `integration.disconnect` permission to remove one. Adding an account SHALL convert existing personal records for installations on that account into a single organization-owned record, preserving the earliest installing user as provenance. Removing an account SHALL return its installations to personal ownership by that recorded user. Neither operation SHALL be performed automatically by a data migration.

#### Scenario: Member attempts to allowlist an account

- **WHEN** a user with role `member` submits an account to the allowlist
- **THEN** the response is 403 and the allowlist is unchanged

#### Scenario: Duplicate personal records are collapsed on promotion

- **WHEN** an admin allowlists an account for which several members hold personal records of the same installation
- **THEN** exactly one organization-owned record remains for that installation, recording the earliest installing user as provenance, and the duplicate records are removed

#### Scenario: Promotion is repeated

- **WHEN** the promotion for an already-allowlisted account runs again
- **THEN** the result is unchanged, with exactly one organization-owned record per installation

#### Scenario: Demotion returns an installation to its installer

- **WHEN** an admin removes an account from the allowlist
- **THEN** its installations are no longer organization-owned and remain available to the user recorded as having installed them

#### Scenario: Existing installations after the schema migration

- **WHEN** the migration that introduces organization ownership runs
- **THEN** every pre-existing installation record remains personal, and no installation becomes organization-owned without an administrative action

### Requirement: A single member's synchronization never removes organization-owned installations

The system SHALL NOT delete an organization-owned installation record as a consequence of it being absent from an individual user's view of their installations. Removal of an organization-owned installation SHALL originate only from a GitHub installation-deleted event or from reconciliation against the App's own installation list. Pruning of personal records SHALL remain scoped to their owning user.

#### Scenario: Member syncs while unable to see the org installation

- **WHEN** a member whose GitHub account can no longer see an allowlisted account's installation runs an installation sync
- **THEN** the organization-owned record is retained and other members continue to resolve it

#### Scenario: App is uninstalled at GitHub

- **WHEN** GitHub reports that an installation was deleted
- **THEN** the corresponding organization-owned record is removed

#### Scenario: Reconciliation against the App's installation list

- **WHEN** reconciliation runs and the App's own installation list no longer contains an organization-owned installation
- **THEN** the stale record is removed

#### Scenario: Personal pruning is unaffected

- **WHEN** a user syncs and one of their personal installations is absent from their view
- **THEN** that personal record is removed and no other user's records are affected
