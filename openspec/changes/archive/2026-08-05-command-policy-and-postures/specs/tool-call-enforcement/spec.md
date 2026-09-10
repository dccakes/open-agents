## ADDED Requirements

### Requirement: Policy is enforced inside the shared tool factories
Policy SHALL be evaluated inside the tool implementations in `packages/agent/tools/`, not in a wrapper around any single agent's dispatch. Every constructor of a policy-bearing tool SHALL therefore be covered without passing options at each construction site.

#### Scenario: A newly constructed bash tool is policed
- **WHEN** a new `ToolLoopAgent` constructs a bash tool with no options
- **THEN** its bash calls are evaluated against the policy in context

#### Scenario: Enforcement is not attached to a single agent
- **WHEN** the main agent's dispatch is inspected
- **THEN** no policy wrapper exists there, and enforcement is located in the tool implementations

### Requirement: Policy travels on the agent execution context
The policy and posture SHALL be carried on `experimental_context` alongside the sandbox and model, and SHALL be readable from both a tool's `execute` and its `needsApproval` callback. Tool factory signatures SHALL NOT be required to change to receive it.

#### Scenario: Both hooks can read the policy
- **WHEN** a tool's `needsApproval` and `execute` run
- **THEN** each can resolve the policy and posture from the execution context

#### Scenario: Existing factory call sites still compile
- **WHEN** an existing zero-argument tool factory call is inspected
- **THEN** it is unchanged and the tool is still policed

### Requirement: Execute is the authoritative gate and re-evaluates policy
A tool's `execute` SHALL re-evaluate the policy for the call it is about to perform, and SHALL refuse a `deny` decision regardless of whether an approval pause occurred. Approval SHALL NOT be treated as a substitute for evaluation.

#### Scenario: A rule added between pause and resume is honoured
- **WHEN** a tool call is approved, and the policy is changed to deny that call before the resumed run executes it
- **THEN** the call is refused

#### Scenario: A denied call never reaches the sandbox
- **WHEN** a `deny` decision is returned for a bash call
- **THEN** no sandbox execution is attempted

### Requirement: A denial is returned as a structured tool result the model can react to
On a `deny` decision, the tool SHALL return a structured result identifying the refusal, the matching rule, and the reason, rather than throwing. The run SHALL continue.

#### Scenario: The model receives the denial
- **WHEN** a bash call is denied
- **THEN** the tool result states that the command was refused by policy, names the reason, and the agent loop proceeds to the next step

#### Scenario: Denial is not an exception
- **WHEN** a call is denied
- **THEN** no error is thrown out of the tool and the run is not marked failed

### Requirement: Missing policy fails closed for side-effecting tools
When no policy is present on the execution context, tools that can mutate state or reach the network SHALL refuse with a structured error. Read-only tools SHALL continue to operate.

#### Scenario: Bash without a policy refuses
- **WHEN** a bash call runs with no policy in context
- **THEN** it refuses with a structured error naming the missing policy

#### Scenario: Read-only tools still work without a policy
- **WHEN** a file read runs with no policy in context
- **THEN** it executes normally

### Requirement: Every subagent is wired with the session policy
The policy and posture SHALL be threaded into each subagent through its call options and into the execution context its `prepareCall` builds. A test SHALL enumerate the subagent registry and assert that every registered subagent threads policy, so that adding a subagent without wiring it fails CI.

#### Scenario: An executor bash call is policed identically to the main agent
- **WHEN** the executor subagent issues a bash call that the main agent's policy would deny
- **THEN** it is denied identically

#### Scenario: A new unwired subagent fails the suite
- **WHEN** a subagent is added to the registry without policy threading
- **THEN** the registry conformance test fails

### Requirement: The read-only subagent is restricted by enforcement, not by prompt text
A subagent declared read-only SHALL run its bash tool under a read-only policy profile in which write-class and network-class decisions are `deny`. Its prompt SHALL state that the restriction is enforced.

#### Scenario: Explorer cannot write a file through bash
- **WHEN** the explorer subagent is instructed to write a file using a shell redirect, `sed -i`, or any other write-class command
- **THEN** the command is denied and no file is created or modified

#### Scenario: Explorer cannot install packages
- **WHEN** the explorer subagent runs a package install command
- **THEN** it is denied

#### Scenario: Explorer's read-only work is unaffected
- **WHEN** the explorer subagent runs list, git status, git log, or git diff commands
- **THEN** they execute normally

### Requirement: An approval decision inside a subagent auto-denies with a structured error
Because a subagent has no interactive approver, an `ask` decision within a subagent SHALL resolve to a denial carrying a structured error that identifies it as an unavailable approval. The parent agent SHALL be able to attempt the operation itself under a real approval.

#### Scenario: Subagent hits an ask decision
- **WHEN** a subagent issues a command whose decision is `ask`
- **THEN** the command does not execute, the subagent receives a structured error naming the reason as an unavailable approval, and the parent run is not paused

#### Scenario: The parent can retry under a real approval
- **WHEN** the parent agent issues the same command after the subagent's denial
- **THEN** the parent pauses for approval in the normal way

### Requirement: Policy decisions of interest are recorded in an append-only log
The system SHALL record every `deny` decision and every `ask` decision in an append-only `policy_event` table, identifying the session, the run, the tool, a redacted summary of the input, the decision, the matching rule, the posture, and the time. Records SHALL NOT be updated or deleted by any application path.

#### Scenario: A denial is recorded
- **WHEN** a tool call is denied by policy
- **THEN** a `policy_event` row exists identifying the session, tool, rule, posture, and decision

#### Scenario: An approval request is recorded
- **WHEN** a tool call produces an `ask` decision
- **THEN** a `policy_event` row is recorded for it

#### Scenario: Secrets are not written to the log
- **WHEN** a denied command contains a credential-shaped string
- **THEN** the recorded input summary is redacted and does not contain the credential

#### Scenario: The log is insert-only
- **WHEN** the application is inspected for update or delete paths on `policy_event`
- **THEN** none exists

### Requirement: Enforcement adds no I/O to the tool hot path
Policy enforcement SHALL NOT introduce a sandbox round trip or a network call into a tool's approval or execution path.

#### Scenario: No new round trips
- **WHEN** a policed bash call executes
- **THEN** the number of sandbox round trips is unchanged from before this change
