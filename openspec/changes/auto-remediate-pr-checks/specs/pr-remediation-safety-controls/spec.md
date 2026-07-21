## ADDED Requirements

### Requirement: Attempt budget is enforced per PR head SHA
The system MUST enforce a maximum number of automatic remediation attempts for each unique PR head SHA.

#### Scenario: Budget exhausted for current head SHA
- **WHEN** attempt count reaches configured maximum for the PR head SHA
- **THEN** no further automatic remediation attempts are triggered for that head SHA

### Requirement: Cooldown is enforced between attempts
The system MUST enforce a minimum cooldown interval between automatic remediation attempts.

#### Scenario: Failure detected during cooldown window
- **WHEN** failing checks are observed before cooldown has elapsed
- **THEN** remediation is deferred until cooldown expires

### Requirement: Fingerprint dedupe prevents repeated identical retries
The system MUST skip automatic remediation when the failure fingerprint is unchanged from the most recent attempted fingerprint for the same head SHA.

#### Scenario: Same failing checks reappear unchanged
- **WHEN** reevaluation produces the same failure fingerprint as the last attempt
- **THEN** remediation is not retriggered and state is recorded as deduped

### Requirement: Safety controls stop on terminal PR state
The system MUST abort pending remediation activity when PR status transitions to closed or merged.

#### Scenario: PR closed during cooldown
- **WHEN** PR becomes closed before the next eligible retry window
- **THEN** pending retry is canceled
