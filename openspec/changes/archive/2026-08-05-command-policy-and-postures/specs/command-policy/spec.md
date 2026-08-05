## ADDED Requirements

### Requirement: A typed policy vocabulary exists in the agent package
The system SHALL provide a `packages/agent/policy/` module defining, as Zod schemas with types derived by `z.infer`, a `PolicyRule` (matching on tool name and, for bash, a command pattern, carrying an action of `allow`, `deny`, or `ask`), a `Posture` (`strict | auto | dangerous`), and a `PolicyDecision`. A `PolicyDecision` SHALL carry the resolved action, the rule that produced it, and a human-readable reason suitable for display and for return to the model.

#### Scenario: A decision identifies its cause
- **WHEN** a tool call is evaluated against the policy
- **THEN** the returned decision names the action, the matching rule, and a reason string

#### Scenario: Types are derived, not duplicated
- **WHEN** the module's types are inspected
- **THEN** every exported policy type is derived from its Zod schema rather than declared separately

### Requirement: Policy evaluation is a pure function of the tool call, policy, and posture
The system SHALL expose `evaluate(toolCall, policy, posture): PolicyDecision`, which SHALL perform no I/O, no network access, and no sandbox access.

#### Scenario: Evaluation is deterministic
- **WHEN** the same tool call, policy, and posture are evaluated twice
- **THEN** both evaluations return the same decision

#### Scenario: Evaluation performs no I/O
- **WHEN** evaluation runs with the sandbox unavailable
- **THEN** it still returns a decision

### Requirement: Compound bash commands are segmented and every segment is evaluated
Bash commands SHALL be parsed into segments before matching. The parser SHALL treat `&&`, `||`, `;`, `|`, `&`, and newlines as segment separators; SHALL descend into command substitutions (`$(...)` and backticks) and into the string argument of `sh -c` / `bash -c`; SHALL strip leading `VAR=value` environment assignments before identifying a segment's command; and SHALL respect single and double quoting, so a separator inside a quoted string is not a separator. The decision for the whole call SHALL be the most restrictive decision among its segments, with `deny` more restrictive than `ask` and `ask` more restrictive than `allow`.

#### Scenario: A dangerous segment after a benign one
- **WHEN** the command is `ls && rm -rf /`
- **THEN** the decision is `deny`

#### Scenario: A dangerous segment inside a nested shell
- **WHEN** the command is `ls; sh -c 'rm -rf /'`
- **THEN** the decision is `deny`

#### Scenario: A separator inside quotes is not a separator
- **WHEN** the command is `echo "a && b"`
- **THEN** the command is evaluated as a single `echo` segment and the decision is `allow`

#### Scenario: Environment-prefixed commands are identified correctly
- **WHEN** the command is `NODE_ENV=production npm publish`
- **THEN** the segment's command is identified as `npm publish` and the decision is `ask`

#### Scenario: A wrapper does not change which command is evaluated
- **WHEN** the command is `sudo npm install`, `env FOO=1 npm publish`, or `timeout 60 git push`
- **THEN** each reaches the same decision as the unwrapped command, and the decision reports the segment as written

#### Scenario: A name appearing as an argument is not a command
- **WHEN** the command is `cat scripts/npm-install-notes.md` or `echo "sudo npm install"`
- **THEN** the decision is `allow`: the gated command's name appears only as text

#### Scenario: Command substitution is evaluated
- **WHEN** the command is `echo $(cat ~/.ssh/id_rsa)`
- **THEN** the substituted segment is evaluated and the decision is not `allow`

#### Scenario: A heredoc body is data, not commands
- **WHEN** a command writes a heredoc whose body contains a line reading `rm -rf /`
- **THEN** the heredoc body is not evaluated as a command, and the command introducing the heredoc is evaluated

#### Scenario: Most restrictive segment wins
- **WHEN** a command chains a segment that would be allowed with one that would require approval
- **THEN** the decision for the whole call is `ask`

### Requirement: Unparseable commands resolve to an explicit unknown decision
When the parser cannot produce a confident parse, the call SHALL be treated as `unknown` rather than matched against patterns on the raw string. `unknown` SHALL resolve to `ask` under the `strict` and `auto` postures and to `allow` under `dangerous`. `unknown` SHALL never resolve to `allow` under the default posture.

#### Scenario: Unparseable input under the default posture
- **WHEN** a command cannot be parsed and the posture is `auto`
- **THEN** the decision is `ask` and the reason states that the command could not be parsed

#### Scenario: Unparseable input under strict
- **WHEN** a command cannot be parsed and the posture is `strict`
- **THEN** the decision is `ask`

### Requirement: Rules are evaluated deny-first, then ask, then allow
Rule matching SHALL check `deny` rules first, then `ask` rules, then `allow` rules, taking the first match within each class. An `allow` rule SHALL NOT be able to override a matching `deny` rule.

#### Scenario: An allow rule cannot override a deny rule
- **WHEN** a command matches both an `allow` rule and a `deny` rule
- **THEN** the decision is `deny`

#### Scenario: A deny rule takes precedence over an ask rule
- **WHEN** a command matches both an `ask` rule and a `deny` rule
- **THEN** the decision is `deny`

### Requirement: A default policy baseline ships with the agent package
The system SHALL ship a `default-policy.ts` baseline that, at minimum: denies `rm -rf /`-class filesystem destruction, denies credential exfiltration patterns (including environment dumps and reads of credential paths piped to a network command), and denies force-pushes to a repository's default branch; asks for `git push`, package publishes, package installs, and piping a network download into a shell; and allows read-only inspection and ordinary build, test, lint, and typecheck commands.

#### Scenario: Filesystem destruction is denied
- **WHEN** a command in the `rm -rf /` family is evaluated under any posture
- **THEN** the decision is `deny`

#### Scenario: Credential exfiltration is denied
- **WHEN** a command pipes the output of an environment dump or a credential file read to a network command
- **THEN** the decision is `deny`

#### Scenario: Force-push to a default branch is denied
- **WHEN** a command force-pushes to `main` or `master`
- **THEN** the decision is `deny`

#### Scenario: An ordinary push asks
- **WHEN** the command is `git push origin my-feature-branch`
- **THEN** the decision is `ask`

#### Scenario: Piping a download into a shell asks
- **WHEN** the command pipes `curl` output into `sh`
- **THEN** the decision is `ask`

#### Scenario: Build and test commands are allowed
- **WHEN** the command runs the project's test, lint, typecheck, or build script
- **THEN** the decision is `allow`

### Requirement: The existing bash approval denylist is absorbed without weakening it
The patterns currently enforced by `commandNeedsApproval` — recursive-force deletion, `find -delete` / `find -exec rm`, `shred`/`mkfs`/`dd`, fork bombs, and references to dotenv files, cloud credential files, SSH keys, and `/proc/self/environ` — SHALL be represented in the default policy such that no command that requires approval before this change is allowed without approval after it.

#### Scenario: A previously gated command stays gated
- **WHEN** any command that `commandNeedsApproval` returns true for today is evaluated under the `auto` posture
- **THEN** the decision is `ask` or `deny`, never `allow`

#### Scenario: Existing approval assertions still hold
- **WHEN** the existing bash approval test cases are run against the new policy
- **THEN** each command's outcome is at least as restrictive as before

### Requirement: A golden corpus guards the default policy in CI
The system SHALL maintain a fixture file mapping real command strings to their expected decisions, exercised by a test that runs as part of `bun run ci`. The corpus SHALL cover chained commands, quoting, environment-prefixed commands, heredocs, nested shells, command substitution, and each rule class in the baseline.

#### Scenario: A regression in the baseline fails CI
- **WHEN** `default-policy.ts` is edited so that piping a network download into a shell is allowed
- **THEN** the golden corpus test fails

#### Scenario: The corpus covers parser edge cases
- **WHEN** the corpus is inspected
- **THEN** it contains cases for chained commands, quoted separators, environment-prefixed commands, heredocs, nested `sh -c`, and command substitution

### Requirement: Policy evaluation meets a latency budget
Evaluation of a single tool call SHALL complete in under 5 ms at p95, measured over the golden corpus. This budget applies to `evaluate()` itself; it does not apply to unrelated I/O that other approval checks perform.

#### Scenario: Evaluation latency is measured
- **WHEN** the benchmark test evaluates every corpus entry
- **THEN** the p95 evaluation time is under 5 ms

### Requirement: Policy rules are defined in code this phase
The default policy SHALL be defined in the agent package's source rather than loaded from the database or edited at runtime. Documentation SHALL state that per-organization rule editing is deferred.

#### Scenario: No runtime rule editing surface exists
- **WHEN** the application is inspected for a policy-rule editing endpoint or table
- **THEN** none exists, and the documentation states that rules are code-defined this phase
