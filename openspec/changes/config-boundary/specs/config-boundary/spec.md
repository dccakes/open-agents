## ADDED Requirements

### Requirement: Configuration is read only through config modules
Application and package code SHALL NOT read `process.env` or `Bun.env`
directly. Every variable SHALL be declared in a config module —
`apps/web/lib/config/<concern>.ts` for the web app, `packages/<name>/config.ts`
for a package — and reached through that module's typed accessor.

#### Scenario: A new environment read is added outside the boundary
- **WHEN** a file outside the allowlist reads `process.env`
- **THEN** `bun run ci` fails, printing the file, line, and the config module the variable belongs in

#### Scenario: A file legitimately runs outside the app runtime
- **WHEN** the file is a test, a build script, `drizzle.config.ts`, `next.config.ts`, `lib/db/migrate.ts`, or an `instrumentation` entry point
- **THEN** it is allowlisted in `scripts/check-env-boundary.ts` and may read the environment directly

#### Scenario: A provider config field is looked up by key at runtime
- **WHEN** code needs a variable whose name is only known at runtime, such as a sandbox provider's declared config fields
- **THEN** it calls the config module's dynamic accessor rather than indexing `process.env`

### Requirement: Every variable declares an environment axis
Each declared variable SHALL carry an axis of `required-prod`, `optional`, or
`dev-only`, plus a one-line description. A variable that is only required once
a related integration is configured SHALL declare that dependency rather than
being marked `required-prod` outright.

#### Scenario: An integration is configured incompletely in production
- **WHEN** a production deployment sets `LINEAR_CLIENT_ID` but not `LINEAR_WEBHOOK_SECRET`
- **THEN** validation fails, naming `LINEAR_WEBHOOK_SECRET` and the variable that made it required

#### Scenario: An integration is not configured at all
- **WHEN** a production deployment sets none of the Linear variables
- **THEN** validation passes — the integration is simply off

### Requirement: Configuration is validated before a deploy completes
A production deployment missing a required variable SHALL fail during the
build, with an error naming the variable. Validation SHALL also run at server
start. Enforcement SHALL key on the deployment environment so preview and local
builds are unaffected.

#### Scenario: Production build with a missing required variable
- **WHEN** `VERCEL_ENV=production` and `POSTGRES_URL` is unset
- **THEN** `bun run build` exits non-zero with `POSTGRES_URL is required in production` and its description

#### Scenario: Preview build without optional integrations
- **WHEN** `VERCEL_ENV=preview` and the optional integration variables are unset
- **THEN** the build proceeds

#### Scenario: Development-only variable set in production
- **WHEN** a `dev-only` variable such as `DOCKER_SANDBOX_IMAGE` is set on a production deployment
- **THEN** validation emits a warning and does not fail

### Requirement: .env.example is generated from the schemas
`apps/web/.env.example` SHALL be generated from the config modules, grouped by
concern, with each variable's description and axis, and secrets left blank.

#### Scenario: A variable is added to a config module
- **WHEN** a new variable is declared and `.env.example` is not regenerated
- **THEN** the `.env.example` test fails, pointing at `bun run --cwd apps/web env:example`

#### Scenario: The example is checked against the schemas
- **WHEN** the example file is parsed and each value validated against its declared schema
- **THEN** every declared variable parses successfully with its example or a dummy value
