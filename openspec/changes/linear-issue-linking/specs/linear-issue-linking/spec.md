## ADDED Requirements

### Requirement: User can search and select a Linear issue when creating a session
The New Session form SHALL display an optional "Link Linear issue" combobox when a Linear workspace is connected. The combobox SHALL search issues by text as the user types and allow selecting one issue to link.

#### Scenario: Workspace connected, user searches for an issue
- **WHEN** a Linear workspace is connected and the user types in the issue picker
- **THEN** issues matching the query are fetched from `/api/linear/issues?q=<query>` and displayed as options (identifier + title)

#### Scenario: User selects an issue
- **WHEN** the user selects an issue from the picker
- **THEN** the `linearIssueId` and `linearIssueUrl` are captured and submitted with the session creation request

#### Scenario: No workspace connected
- **WHEN** no Linear workspace is connected
- **THEN** the issue picker is not displayed in the New Session form

#### Scenario: User creates session without linking an issue
- **WHEN** the user leaves the issue picker empty and submits the session form
- **THEN** the session is created normally with `linearIssueId` as null

### Requirement: Issue search endpoint returns matching Linear issues
`GET /api/linear/issues?q=<query>` SHALL return a list of matching issues from the connected Linear workspace using a text search.

#### Scenario: Successful search
- **WHEN** a request is made to `/api/linear/issues?q=login+bug` and a workspace token exists
- **THEN** the response contains a list of issues with `{ id, identifier, title, url }` matching the query

#### Scenario: Empty query returns recent issues
- **WHEN** a request is made to `/api/linear/issues` with no query parameter
- **THEN** the response returns the most recently updated open issues (up to 20)

#### Scenario: No workspace connected
- **WHEN** a request is made to `/api/linear/issues` and no workspace token exists
- **THEN** the response returns 401

### Requirement: Linked issue content is injected into the agent's initial context
When a session is created with a `linearIssueId`, the system SHALL fetch the full issue (title, description) and append it to the agent's initial context before session creation.

#### Scenario: Issue context injected
- **WHEN** a session is created with a `linearIssueId`
- **THEN** the agent's initial context includes the issue identifier, title, and description in a structured block

#### Scenario: Issue description truncated when too long
- **WHEN** the linked issue's description exceeds 2000 characters
- **THEN** it is truncated with a note indicating truncation before being injected into context

#### Scenario: Issue fetch fails at session creation
- **WHEN** the Linear API call to fetch the issue fails during session creation
- **THEN** the session is created without the issue context and no error is surfaced to the user (silent degradation)

### Requirement: Session detail view shows linked Linear issue
When a session has a `linearIssueId`, the session detail view SHALL display a badge showing the issue identifier and title, linking out to Linear.

#### Scenario: Session has linked issue
- **WHEN** the user views a session detail page and the session has a `linearIssueId`
- **THEN** a badge is shown with the issue identifier (e.g., "ENG-123"), the title, and a link to the Linear issue URL

#### Scenario: Session has no linked issue
- **WHEN** the user views a session detail page and the session has no `linearIssueId`
- **THEN** no Linear badge is shown
