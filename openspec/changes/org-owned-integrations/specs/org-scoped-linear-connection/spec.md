## Purpose

Scopes the Linear workspace connection to the organization rather than to whoever ran the OAuth flow, and gives Linear actors a deliberate way to resolve to an organization member when their Linear address differs from their sign-in address.

## ADDED Requirements

### Requirement: The Linear workspace connection belongs to the organization

The system SHALL associate each Linear workspace connection with an organization and SHALL resolve the active connection by organization rather than by record age or by the user who created it. At most one active connection SHALL exist per organization. The connecting user SHALL be retained as provenance only.

#### Scenario: Connection is resolved for use

- **WHEN** any part of the system resolves the Linear connection to act on the workspace
- **THEN** the connection associated with the organization is returned, independent of which user created it

#### Scenario: Existing connection after migration

- **WHEN** the migration introducing organization scope runs against a deployment with a connected workspace
- **THEN** the existing connection is associated with the organization and remains usable with no reconnection

#### Scenario: A second connection is attempted

- **WHEN** a connection is established for an organization that already has one
- **THEN** the organization still has exactly one active connection

#### Scenario: The connecting user is removed from the organization

- **WHEN** the user recorded as having connected the workspace is removed from the organization
- **THEN** the connection remains active and usable by remaining approved members

### Requirement: Linear actors resolve to approved members through verified email or an explicit mapping

The system SHALL resolve a Linear actor to an organization member when either the actor's email matches a user with a verified email address, or an administrator has recorded an explicit mapping from that Linear user identity to a QuackOps user. The resolved user SHALL additionally be an approved member of the organization. The system SHALL NOT resolve an unmatched actor to any default, fallback, or organization identity.

#### Scenario: Actor email matches a verified user

- **WHEN** a Linear event arrives whose actor email matches an approved member with a verified email address
- **THEN** the actor resolves to that member and the requested work may proceed

#### Scenario: Actor email matches an unverified address

- **WHEN** a Linear event arrives whose actor email matches a user whose email is not verified, and no explicit mapping exists
- **THEN** the actor does not resolve and no agent run is started

#### Scenario: Actor is mapped explicitly

- **WHEN** a Linear event arrives from an actor whose Linear address differs from their sign-in address, and an administrator has mapped that Linear user identity to their QuackOps user
- **THEN** the actor resolves to the mapped member

#### Scenario: Mapping overrides a conflicting email match

- **WHEN** an explicit mapping exists for a Linear user identity and the actor's email also matches a different user
- **THEN** the actor resolves to the explicitly mapped user

#### Scenario: Actor cannot be resolved

- **WHEN** a Linear event arrives from an actor with neither a verified email match nor an explicit mapping
- **THEN** the actor does not resolve, no agent run is started, and the outcome is distinguishable from a resolved-but-pending actor

#### Scenario: Resolved actor is pending approval

- **WHEN** a Linear actor resolves to a user who holds no membership in the organization
- **THEN** no agent run is started

#### Scenario: Mapped user is later removed from the organization

- **WHEN** a Linear event arrives for an actor mapped to a user who has since been removed from the organization
- **THEN** no agent run is started, even though the mapping still exists

### Requirement: Linear actor mappings are administered under permission

The system SHALL require the `integration.connect` permission to create or delete a Linear actor mapping. Approved members SHALL be able to read which mappings exist.

#### Scenario: Member creates a mapping

- **WHEN** a user with role `member` submits a new Linear actor mapping
- **THEN** the response is 403 and no mapping is created

#### Scenario: Member reads mappings

- **WHEN** a user with role `member` requests the list of Linear actor mappings
- **THEN** the request succeeds

#### Scenario: One Linear identity maps to at most one user

- **WHEN** an admin creates a mapping for a Linear user identity that is already mapped
- **THEN** that Linear identity still resolves to exactly one QuackOps user
