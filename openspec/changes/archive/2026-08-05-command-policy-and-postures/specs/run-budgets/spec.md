## ADDED Requirements

### Requirement: Usage events are attributable to a session and a workflow run
The system SHALL add `sessionId` and `workflowRunId` to `usage_events`, populated on every write from the agent workflow, and SHALL add the indexes required to query the table by user and time and by workflow run. Existing rows SHALL remain valid with these columns null.

#### Scenario: A run's usage is attributable
- **WHEN** an agent run completes
- **THEN** its usage rows carry the session id and the workflow run id

#### Scenario: Historical rows are preserved
- **WHEN** the migration runs against a database with existing usage rows
- **THEN** those rows are retained with null attribution columns and no write path fails

#### Scenario: Per-session cost is queryable
- **WHEN** the cost of a session is requested
- **THEN** it can be computed from `usage_events` without scanning the whole table

### Requirement: A run's spend is observable while the run is in flight
The system SHALL record a run's accumulated input tokens, output tokens, and step count as the run progresses, so that spend is visible before the run ends. The run record SHALL distinguish an in-progress run from a finished one.

#### Scenario: Spend is visible mid-run
- **WHEN** a run has executed several steps and has not finished
- **THEN** its accumulated tokens and step count can be read

#### Scenario: In-progress runs are distinguishable
- **WHEN** run records are queried
- **THEN** an in-progress run is distinguishable from a finished one by an unset finish time

#### Scenario: A crashed run leaves a visible record
- **WHEN** a run terminates without recording completion
- **THEN** its record remains in the in-progress state rather than disappearing

### Requirement: Runs are bounded by a token budget and a step budget
The system SHALL enforce a per-run token budget and a per-run step budget, checked in the agent workflow loop as usage accumulates. The step budget SHALL replace the hard-coded step ceiling in the chat run-start path. Both SHALL be configurable through the configuration module, and a token budget MAY be unset, meaning unlimited.

#### Scenario: Token budget is exceeded
- **WHEN** a run's accumulated tokens exceed its token budget
- **THEN** the run halts before starting another step

#### Scenario: Step budget is exceeded
- **WHEN** a run reaches its step budget
- **THEN** the run halts

#### Scenario: Unset token budget
- **WHEN** no token budget is configured
- **THEN** the run is bounded by the step budget alone and no token check halts it

#### Scenario: Budgets survive a resumed run
- **WHEN** a run resumes after an approval pause
- **THEN** the budget is evaluated against the run's persisted accumulated usage rather than restarting from zero

### Requirement: A budget breach halts the run in a distinct, visible state
A run halted by a budget SHALL terminate in a structured `budget-exceeded` state distinguishable from an ordinary failure or an aborted run, naming which budget was exceeded and the totals at the time of the halt. The state SHALL be surfaced in the session UI.

#### Scenario: The halt state is distinct
- **WHEN** a run halts on a budget breach
- **THEN** its recorded state is `budget-exceeded` and not a generic failure

#### Scenario: The halt is visible to the user
- **WHEN** a run halts on a budget breach
- **THEN** the session UI shows that the run stopped because a budget was exceeded, and which one

#### Scenario: Work already done is preserved
- **WHEN** a run halts on a budget breach
- **THEN** the assistant output produced before the halt is persisted and the session is not discarded

#### Scenario: Downstream triggers can report the halt
- **WHEN** a run started by a non-interactive trigger halts on a budget breach
- **THEN** the halt reason and the session link are available to that trigger's reporting path rather than only a log line

### Requirement: The organization daily token budget is enforced
The system SHALL consume the organization's configured daily token budget, refusing to start a new run when the organization's token consumption for the current UTC day has reached the limit, and halting an in-flight run that crosses it. A null configured budget SHALL mean unlimited.

#### Scenario: Daily budget is reached before a run starts
- **WHEN** a user starts a run and the organization's usage for the current UTC day has reached the daily budget
- **THEN** no workflow run is created and the caller receives a structured refusal

#### Scenario: Daily budget is crossed mid-run
- **WHEN** a run in flight causes the organization to cross the daily budget
- **THEN** the run halts in the `budget-exceeded` state

#### Scenario: Unlimited daily budget
- **WHEN** the organization's daily token budget is null
- **THEN** no daily limit is applied

#### Scenario: The day boundary is stated
- **WHEN** the daily budget is displayed
- **THEN** the UI states that the day boundary is UTC midnight

### Requirement: Budget checks fail closed
If the organization budget cannot be read, the system SHALL refuse to start the run rather than defaulting to permitted, matching the behaviour of the existing run-start gate.

#### Scenario: Budget read fails at run start
- **WHEN** the organization settings lookup errors during a run-start request
- **THEN** no workflow run is created and the caller receives an error

### Requirement: Reconnecting to a running run is not blocked by budgets
A budget refusal SHALL apply to starting a new run. Reconnecting to a run already in flight SHALL continue to work, consistent with the existing run-start gate.

#### Scenario: Reconnect while over budget
- **WHEN** a client reconnects to a run already in flight and the organization is over its daily budget
- **THEN** the reconnect succeeds and the existing stream is returned

### Requirement: Budget configuration is declared in the configuration module
Every environment variable introduced for budgets or approval timeouts SHALL be declared in a configuration module with a schema, a one-line description, and an environment axis; SHALL be read only through that module's accessors; SHALL be reflected in the regenerated example environment file; and SHALL be covered by a schema-parse test in the same change.

#### Scenario: No raw environment reads
- **WHEN** the environment-boundary check runs
- **THEN** no budget or approval variable is read outside a configuration module

#### Scenario: The example file matches the schemas
- **WHEN** the example environment file check runs
- **THEN** it reflects the newly declared variables
