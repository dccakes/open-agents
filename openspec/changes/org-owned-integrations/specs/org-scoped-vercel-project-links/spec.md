## Purpose

Treats the mapping from a repository to a Vercel project as a fact about the repository that the organization owns, instead of a per-person record that teammates maintain separately and can silently disagree about.

## ADDED Requirements

### Requirement: Repository-to-project links are scoped to the organization

The system SHALL scope each repository-to-Vercel-project link to the organization and the repository, so that all approved members resolve the same project for the same repository. The user who created a link SHALL be retained as provenance only. The per-user Vercel credential SHALL continue to be used to perform Vercel API calls on that member's behalf.

#### Scenario: Two members resolve the same repository

- **WHEN** two approved members resolve the Vercel project for the same repository
- **THEN** both resolve the same project

#### Scenario: Member without their own prior link

- **WHEN** an approved member who never created a link resolves the Vercel project for a repository the organization has linked
- **THEN** the organization's link is returned

#### Scenario: Vercel calls still use the member's own credential

- **WHEN** an approved member performs an action against a linked Vercel project
- **THEN** the call is made with that member's own Vercel credential, and a member without one is prompted to connect Vercel

### Requirement: An organization Vercel team is recorded

The system SHALL allow an administrator to record the Vercel team that the organization's projects belong to, and SHALL require the `integration.connect` permission to set or change it. Approved members SHALL be able to read it.

#### Scenario: Member changes the organization Vercel team

- **WHEN** a user with role `member` submits a change to the organization's Vercel team
- **THEN** the response is 403 and the recorded team is unchanged

#### Scenario: Admin records the team

- **WHEN** an admin records the organization's Vercel team
- **THEN** the team is persisted and readable by approved members

### Requirement: Existing links migrate only where members already agree

The system SHALL migrate a repository's existing per-user links to a single organization link only when every such link names the same Vercel project. Where per-user links for a repository name different projects, the system SHALL NOT create an organization link for that repository, SHALL retain the existing per-user links, and SHALL record the disagreement for administrative resolution.

#### Scenario: All members agree on a repository

- **WHEN** the migration runs for a repository where every per-user link names the same project
- **THEN** one organization link is created for that repository and it resolves to that project

#### Scenario: Members disagree on a repository

- **WHEN** the migration runs for a repository where per-user links name different projects
- **THEN** no organization link is created for that repository, the per-user links are retained, and the disagreement is recorded

#### Scenario: No link is silently chosen

- **WHEN** a repository's links are in disagreement
- **THEN** no project is selected on the members' behalf by any automatic rule

#### Scenario: Resolution during the transition

- **WHEN** a member resolves the Vercel project for a repository that has no organization link but does have their own personal link
- **THEN** their personal link is returned

### Requirement: Recorded disagreements are resolvable by an administrator

The system SHALL present recorded repository link disagreements to administrators with the competing projects and the members who recorded them, and SHALL require the `integration.connect` permission to resolve one. Resolving a disagreement SHALL create the organization link for that repository and clear the record.

#### Scenario: Admin resolves a disagreement

- **WHEN** an admin selects the correct project for a repository in disagreement
- **THEN** the organization link is created for that repository and the disagreement no longer appears as unresolved

#### Scenario: Member attempts to resolve a disagreement

- **WHEN** a user with role `member` submits a resolution for a repository in disagreement
- **THEN** the response is 403 and the disagreement is unchanged

#### Scenario: Removal of the personal fallback is gated on resolution

- **WHEN** the transition step that removes personal link resolution is attempted while unresolved disagreements remain
- **THEN** the step does not proceed
