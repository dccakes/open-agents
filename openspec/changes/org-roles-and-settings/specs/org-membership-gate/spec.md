## ADDED Requirements

### Requirement: Sign-up outside the domain allowlist lands in a pending state
The system SHALL evaluate a newly created user's email against the `ALLOWED_EMAIL_DOMAINS` configuration at account creation. A user whose email domain matches SHALL be granted membership in the seeded organization with role `member`. A user whose email domain does not match, or whose email is absent, SHALL be granted no membership and is therefore `pending`. Domain comparison SHALL be case-insensitive and exact — subdomains do not match a parent domain entry.

#### Scenario: Allowlisted domain signs in for the first time
- **WHEN** a user signs in for the first time with email `someone@nextdegree.org` and `ALLOWED_EMAIL_DOMAINS` contains `nextdegree.org`
- **THEN** an `org_members` row is created for that user in the seeded organization with role `member`, and the user reaches the application normally

#### Scenario: Non-allowlisted domain signs in for the first time
- **WHEN** a user signs in for the first time with email `stranger@example.com`
- **THEN** no `org_members` row is created, the sign-in itself succeeds, and the user is routed to the approval-request screen

#### Scenario: User has no email address
- **WHEN** a user signs in via a provider that supplies no email address
- **THEN** no `org_members` row is created and the user is treated as pending

#### Scenario: Subdomain does not satisfy the allowlist
- **WHEN** a user signs in with email `someone@mail.nextdegree.org` and `ALLOWED_EMAIL_DOMAINS` contains only `nextdegree.org`
- **THEN** no membership is granted and the user is pending

#### Scenario: Allowlist is not configured
- **WHEN** a user signs in for the first time and `ALLOWED_EMAIL_DOMAINS` is unset or empty
- **THEN** no membership is granted and the user is pending — an unconfigured allowlist auto-approves nobody rather than everybody

### Requirement: Linking a second account never grants membership
The membership decision SHALL be made once, from the email on the user record at creation. Linking an additional OAuth provider account to an existing user SHALL NOT re-evaluate the domain allowlist and SHALL NOT create a membership row.

#### Scenario: Pending user links an allowlisted account
- **WHEN** a pending user whose account was created with `stranger@example.com` links a second provider account whose email is `someone@nextdegree.org`
- **THEN** the user remains pending and no membership is created

### Requirement: Pending users cannot reach organization data
The system SHALL enforce approved membership server-side on every route and server action that reads or mutates sessions, integrations, org settings, or agent runs. Enforcement SHALL be a positive membership check, never a negated role comparison. A pending user's request to such an endpoint SHALL receive HTTP 403.

#### Scenario: Pending user requests a session listing
- **WHEN** a pending user issues an authenticated request to a sessions endpoint
- **THEN** the response is 403 and no session data is returned

#### Scenario: Pending user attempts to start an agent run
- **WHEN** a pending user posts to the chat run-start endpoint
- **THEN** the response is 403 and no workflow run is created

#### Scenario: Pending user loads the application UI
- **WHEN** a pending user loads any application page
- **THEN** they see only the approval-request screen, which states that an admin must approve them and offers no navigation into org areas

### Requirement: Admins can approve or reject pending users
The system SHALL provide an admin-area view listing all pending users. A user holding the `membership.approve` permission SHALL be able to approve a pending user, creating an `org_members` row with role `member`. A user holding `membership.reject` SHALL be able to reject a pending user.

#### Scenario: Admin approves a pending user
- **WHEN** an admin approves a pending user from the admin area
- **THEN** an `org_members` row with role `member` is created, an audit record is written, and the user reaches the application on their next request without signing in again

#### Scenario: Member attempts to approve a pending user
- **WHEN** a user holding only role `member` posts to the approval endpoint
- **THEN** the response is 403 and no membership row is created

#### Scenario: Approving an already-approved user
- **WHEN** an admin approves a user who already holds membership
- **THEN** the operation is a no-op that succeeds without creating a duplicate membership row

### Requirement: Existing users are not locked out by the migration
The migration that introduces the membership gate SHALL grant membership in the seeded organization to every user that exists at migration time, so that enabling the gate does not revoke access from a live deployment.

#### Scenario: Deploy of the membership gate to an existing deployment
- **WHEN** the membership-gate migration runs against a database containing existing users
- **THEN** every existing user has an `org_members` row afterwards, and no existing user is routed to the approval-request screen
