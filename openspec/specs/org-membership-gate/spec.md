# org-membership-gate Specification

## Purpose

Make membership the structural chokepoint for organization data, so a pending, removed, or demoted user is denied immediately.

## Requirements

### Requirement: Sign-up outside the domain allowlist lands in a pending state
The system SHALL evaluate a newly created user's email against the `ALLOWED_EMAIL_DOMAINS` configuration at account creation. A user whose email domain matches **and whose email is verified** SHALL be granted membership in the seeded organization with role `member`. A user whose email domain does not match, whose email is absent, or whose email is unverified SHALL be granted no membership and is therefore `pending`. Domain comparison SHALL be case-insensitive and exact — subdomains do not match a parent domain entry.

#### Scenario: Allowlisted domain signs in for the first time
- **WHEN** a user signs in for the first time with email `someone@nextdegree.org` and `ALLOWED_EMAIL_DOMAINS` contains `nextdegree.org`
- **THEN** an `org_members` row is created for that user in the seeded organization with role `member`, and the user reaches the application normally

#### Scenario: Non-allowlisted domain signs in for the first time
- **WHEN** a user signs in for the first time with email `stranger@example.com`
- **THEN** no `org_members` row is created, the sign-in itself succeeds, and the user is routed to the approval-request screen

#### Scenario: User has no email address
- **WHEN** a user signs in via a provider that supplies no email address
- **THEN** no `org_members` row is created and the user is treated as pending

#### Scenario: Allowlisted domain but unverified email
- **WHEN** a user signs in for the first time with an allowlisted email domain but `emailVerified` is false
- **THEN** no `org_members` row is created and the user is pending — an unverified address is not proof of domain membership

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
The system SHALL provide an admin-area view listing all pending users. A user holding the `member.create` permission SHALL be able to approve a pending user, creating an `org_members` row with role `member`. The same permission gates rejecting a pending user.

#### Scenario: Admin approves a pending user
- **WHEN** an admin approves a pending user from the admin area
- **THEN** an `org_members` row with role `member` is created, an audit record is written, and the user reaches the application on their next request without signing in again

#### Scenario: Member attempts to approve a pending user
- **WHEN** a user holding only role `member` posts to the approval endpoint
- **THEN** the response is 403 and no membership row is created

#### Scenario: Approving an already-approved user
- **WHEN** an admin approves a user who already holds membership
- **THEN** the operation is a no-op that succeeds without creating a duplicate membership row

### Requirement: Existing users and sessions are not locked out at cutover
The seeder that introduces the membership gate SHALL grant membership in the seeded organization to every user that exists at cutover, and SHALL backfill `active_organization_id` on existing `auth_sessions` rows, so that enabling the gate revokes neither access nor already-issued sessions on a live deployment.

#### Scenario: Deploy of the membership gate to an existing deployment
- **WHEN** the seeder runs against a database containing existing users
- **THEN** every existing user has an `org_members` row afterwards, and no existing user is routed to the approval-request screen

#### Scenario: Session issued before the cutover
- **WHEN** a user holding a session created before this change makes an authenticated request afterwards
- **THEN** permission checks resolve against the seeded organization and succeed, without requiring the user to sign out and back in

### Requirement: Membership enforcement has a structural chokepoint
Approved-membership enforcement SHALL be implemented at a chokepoint that every authenticated path already crosses — the server session helper — rather than as a per-route list of checks. A newly added authenticated route SHALL be gated by default.

#### Scenario: A new authenticated route is added without an explicit check
- **WHEN** a route obtains an authenticated session through the standard helper and performs no membership check of its own
- **THEN** a pending user's request to it still receives 403

### Requirement: Webhook-triggered runs check the matched user's membership
Run-creation paths that resolve a user by means other than a browser session — notably the Linear webhook, which matches an actor's email to a user — SHALL verify that the matched user holds approved membership before creating a session or starting a run.

#### Scenario: Linear issue delegated to a pending user
- **WHEN** a Linear webhook event resolves to a user who holds no membership row
- **THEN** no session is created and no run is started, and the refusal is reported through the webhook's failure-visibility path

#### Scenario: Linear issue delegated to an approved member
- **WHEN** a Linear webhook event resolves to a user who holds approved membership
- **THEN** the run proceeds subject to the remaining gates

### Requirement: Removal and demotion take effect immediately
Removing, banning, or demoting a member SHALL take effect no later than that user's next request. Sessions belonging to a removed or banned user SHALL be revoked at the time of the action. Session cookie caching SHALL NOT be enabled while permission checks resolve from the session.

#### Scenario: Member is removed while holding a live session
- **WHEN** an admin removes a member who has an active browser session
- **THEN** that user's sessions are revoked and their next request is unauthenticated

#### Scenario: Admin is demoted while holding a live session
- **WHEN** an admin demotes another admin to `member`
- **THEN** the demoted user's next request is evaluated with `member` permissions, without requiring a new sign-in

#### Scenario: Cookie caching is not enabled
- **WHEN** the auth configuration test runs
- **THEN** it asserts session cookie caching is unset, because a cached session would serve a stale role after demotion

#### Scenario: In-flight runs of a removed member
- **WHEN** a member is removed while one of their agent runs is executing
- **THEN** that run is NOT terminated by this capability — terminating it is the admin runs dashboard's per-run stop (WS-1.5), and the removal UI states this rather than implying the run stopped

### Requirement: Share links are gated on membership and revoked on removal
Creating a share link SHALL require approved membership. Shares created by a user SHALL be revoked when that user is removed or banned. Share links already published remain readable by anyone holding the URL; the membership gate's guarantee covers authenticated access paths, not previously published links.

#### Scenario: Pending user attempts to create a share
- **WHEN** a pending user posts to the share-creation endpoint
- **THEN** the response is 403 and no share record is created

#### Scenario: Member is removed while holding published shares
- **WHEN** an admin removes a member who had created share links
- **THEN** those shares are revoked and their URLs no longer resolve

#### Scenario: Scope of the guarantee is stated
- **WHEN** the pending-user requirement is read alongside the public share route
- **THEN** the carve-out above is the governing rule — "cannot reach organization data" means authenticated paths, and public shares are handled by creation gating and revocation
