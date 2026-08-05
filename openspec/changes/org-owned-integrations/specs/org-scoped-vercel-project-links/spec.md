## Purpose

Treats the mapping from a repository to a Vercel project as a fact about the repository that the organization owns, instead of a per-person record that teammates maintain separately and can silently disagree about.

## ADDED Requirements

### Requirement: Repository-to-project links are scoped to the organization

The system SHALL scope each repository-to-Vercel-project link to the organization and the repository, so that all approved members resolve the same project for the same repository. Resolving a link SHALL NOT require a caller identity. The user who created a link SHALL be retained as provenance only. The per-user Vercel credential SHALL continue to be used to perform Vercel API calls on that member's behalf.

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

### Requirement: One project per repository is enforced by the store

The system SHALL key a repository's Vercel project link by the organization and the repository, so that a second member linking the same repository replaces the organization's answer rather than creating a competing one. It SHALL NOT be possible for two members to hold different projects for the same repository.

#### Scenario: A second member links an already-linked repository

- **WHEN** a member links a repository another member has already linked, to a different project
- **THEN** the organization has exactly one link for that repository, naming the newly chosen project

#### Scenario: Provenance survives its author

- **WHEN** the member recorded as having created a link is deleted
- **THEN** the link remains and continues to resolve for every other member
