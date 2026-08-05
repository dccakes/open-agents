## ADDED Requirements

### Requirement: Authentication is configured with the Better Auth organization and admin plugins
The system SHALL configure Better Auth with the organization plugin and the admin plugin. The organization plugin SHALL be configured with `allowUserToCreateOrganization: false`, teams disabled, and dynamic access control disabled. Plugin models SHALL be mapped to repository table names (`organizations`, `org_members`, `org_invitations`) via each plugin's schema mapping options, and the corresponding Drizzle tables SHALL be authored in `apps/web/lib/db/schema.ts` with committed migrations.

#### Scenario: Application boots with plugins configured
- **WHEN** the application starts
- **THEN** the Better Auth instance exposes the organization and admin plugin APIs, and the Drizzle adapter schema map includes the organization, member, and invitation models

#### Scenario: A user attempts to create a second organization
- **WHEN** an authenticated user calls the organization creation API
- **THEN** the request is rejected and no additional organization is created

#### Scenario: Plugin table columns match the plugin's expectations
- **WHEN** the schema-conformance test runs
- **THEN** each hand-authored plugin table — including the **extended `users` and `auth_sessions` tables**, not only the three new ones — is asserted to contain every column the corresponding plugin model requires (notably `users.banned`, `banReason`, `banExpires`, `auth_sessions.impersonatedBy`, and `organizations.metadata`), and the test fails if a column is missing or misnamed

### Requirement: A single organization is seeded and set as the active organization
The system SHALL seed exactly one organization from `DEFAULT_ORG_NAME` and `DEFAULT_ORG_SLUG` configuration. Seeding SHALL be performed by an idempotent runtime seeder invoked at boot, not by a SQL migration, because migrations are static and cannot read configuration. Every authenticated session SHALL carry that organization as `activeOrganizationId`, and permission checks SHALL resolve the organization explicitly rather than relying on that field being populated.

#### Scenario: Session is created for an approved member
- **WHEN** an approved member signs in
- **THEN** the created session record has `active_organization_id` set to the seeded organization's id

#### Scenario: Seeding runs more than once
- **WHEN** the seeding path executes against a database that already contains the seeded organization
- **THEN** it is a no-op and no second organization row is created

#### Scenario: Concurrent boots race to seed
- **WHEN** two instances execute the seeder simultaneously against an empty database
- **THEN** exactly one organization row exists afterwards, enforced by a unique constraint rather than by check-then-insert

#### Scenario: Permission check with a null active organization
- **WHEN** a permission check runs for a session whose `active_organization_id` is NULL
- **THEN** it resolves against the seeded organization and returns a correct decision rather than failing closed

### Requirement: Platform role and organization role are distinct
The system SHALL treat `users.role` as the platform role governing instance-level operations (bulk OAuth token revocation, ban, impersonation, session revocation), and `org_members.role` as the organization role governing shared configuration. Instance-level operations SHALL check the platform role; shared-configuration operations SHALL check organization permissions.

#### Scenario: Org admin without platform admin attempts bulk token revocation
- **WHEN** a user holding org role `admin` but platform role `user` invokes the bulk GitHub token revocation action
- **THEN** the action is refused

#### Scenario: Org admin manages shared configuration
- **WHEN** a user holding org role `admin` updates org settings
- **THEN** the operation succeeds regardless of their platform role

### Requirement: Permissions are defined once in a shared access-control statement set
The system SHALL define its access-control statements and static roles in a single module consumed by the server plugin configuration, the client plugin configuration, and the server-side permission helper. The statement set SHALL cover at minimum the resources `orgSettings`, `integration`, `repoMapping`, `observability`, `agentRun`, `posture`, and `warmCache`, **spread on top of both plugins' `defaultStatements`**.

#### Scenario: Built-in plugin endpoints remain authorized
- **WHEN** an `owner` or `admin` invokes a built-in organization endpoint such as remove-member or update-member-role
- **THEN** the operation is authorized, because the shared statement set includes each plugin's `defaultStatements` and the roles grant the corresponding `member` actions

#### Scenario: Statement set includes the plugin defaults
- **WHEN** the permission-model test runs
- **THEN** it asserts every resource in both plugins' `defaultStatements` is present in the shared statement set, failing if a future edit drops one

#### Scenario: A permission is checked server-side
- **WHEN** a server route calls the permission helper for `orgSettings.update`
- **THEN** the check is evaluated against the caller's organization role using the shared statement set and returns an authoritative allow or deny

#### Scenario: UI hides a control the caller cannot use
- **WHEN** a member without `integration.disconnect` loads the connections settings page
- **THEN** the disconnect control is not rendered

#### Scenario: UI-hidden control is still enforced server-side
- **WHEN** a member without `integration.disconnect` issues the disconnect request directly to the API
- **THEN** the response is 403 and the integration is not disconnected

### Requirement: Role assignments grant the expected capabilities
The `member` role SHALL hold read actions plus `agentRun.create` and `agentRun.read`. The `admin` role SHALL hold every action except organization deletion. The `owner` role SHALL hold every action.

#### Scenario: Member reads org settings
- **WHEN** a user with role `member` reads org settings
- **THEN** the request succeeds

#### Scenario: Member updates org settings
- **WHEN** a user with role `member` attempts to update org settings
- **THEN** the response is 403 and no settings change is persisted

#### Scenario: Admin attempts organization deletion
- **WHEN** a user with role `admin` attempts to delete the organization
- **THEN** the request is refused

### Requirement: Admins are bootstrapped from configuration
The system SHALL grant platform role `admin` and organization role `owner` on first sign-in to any user whose **verified** email appears in the `ADMIN_EMAILS` configuration, so that a fresh deployment is never without an admin. An unverified email SHALL NOT satisfy the bootstrap.

#### Scenario: Configured admin signs in to a fresh deployment
- **WHEN** a user whose email is listed in `ADMIN_EMAILS` signs in for the first time
- **THEN** their user record has platform role `admin` and their membership role is `owner`

#### Scenario: Configured admin email is unverified
- **WHEN** a user signs in with an email listed in `ADMIN_EMAILS` but `emailVerified` is false
- **THEN** neither platform admin nor org owner is granted, and the user is pending — otherwise registering an unverified matching address at any OAuth provider would be a full takeover path

#### Scenario: Configured admin email is outside the domain allowlist
- **WHEN** a user listed in `ADMIN_EMAILS` signs in with an email whose domain is not in `ALLOWED_EMAIL_DOMAINS`
- **THEN** they are still granted membership and admin — the admin allowlist takes precedence over the domain gate

### Requirement: The last remaining admin cannot be demoted or removed
The system SHALL refuse any operation that would leave the organization with zero members holding role `owner` or `admin`, and SHALL refuse to remove or ban the last such member.

#### Scenario: Sole admin attempts self-demotion
- **WHEN** the only remaining admin attempts to set their own role to `member`
- **THEN** the operation is refused with an explanatory error and the role is unchanged

#### Scenario: Sole admin is targeted for removal
- **WHEN** an operation attempts to remove or ban the only remaining admin
- **THEN** the operation is refused and the membership is unchanged

#### Scenario: Demotion is allowed when another admin exists
- **WHEN** an admin demotes another admin while a third admin remains
- **THEN** the operation succeeds and an audit record is written

### Requirement: The platform role has a managed lifecycle
The system SHALL allow a platform admin to grant and revoke `users.role` at runtime, not only through the `ADMIN_EMAILS` bootstrap, and SHALL refuse any operation that would leave the deployment with zero platform admins.

#### Scenario: Platform admin grants platform admin
- **WHEN** a platform admin promotes another user to platform role `admin`
- **THEN** the change is persisted and an audit record is written

#### Scenario: Last platform admin is demoted
- **WHEN** an operation would leave zero users holding platform role `admin`
- **THEN** it is refused, mirroring the org-level last-admin invariant

### Requirement: Admin-plugin capabilities are constrained and audited
Mounting the admin plugin exposes impersonation, user creation, password setting, and session listing. The system SHALL restrict these to platform admins and SHALL write an audit record for every impersonation start and stop.

#### Scenario: Non-platform-admin attempts impersonation
- **WHEN** a user without platform role `admin` calls the impersonation endpoint
- **THEN** the request is refused

#### Scenario: Impersonation is audited
- **WHEN** a platform admin starts and later stops impersonating a user
- **THEN** both events are recorded with actor, target, and timestamp

### Requirement: Existing admin checks continue to work through the role migration
The system SHALL migrate `users.isAdmin` to `users.role` using expand-contract: the `role` column is added and backfilled from `is_admin` before any read path changes, `isUserAdmin()` is repointed to read `role` while keeping its existing signature, and `is_admin` is dropped only in a later migration.

#### Scenario: Existing admin after the backfill migration
- **WHEN** the backfill migration runs against a user with `is_admin = true`
- **THEN** that user's `role` is `admin`

#### Scenario: Existing call sites are unchanged
- **WHEN** `isUserAdmin()` is called after the migration
- **THEN** it returns the same result as before for every user, and its callers required no signature changes

#### Scenario: Rolling deploy window
- **WHEN** the backfill migration has run but a previous deployment's code is still serving requests
- **THEN** that code continues to read `is_admin` successfully because the column has not been dropped

### Requirement: Role management is available in the admin area
The system SHALL provide an admin-area view listing organization members and their roles, allowing a user holding `member.update` to promote or demote members.

#### Scenario: Admin promotes a member
- **WHEN** an admin sets another member's role to `admin`
- **THEN** the membership role is updated and an audit record is written

#### Scenario: Member loads the role management view
- **WHEN** a user holding only role `member` requests the role management view
- **THEN** the view is not available to them and any direct API call returns 403
