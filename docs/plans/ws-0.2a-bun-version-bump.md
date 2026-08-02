# WS-0.2a — Bun version bump

Sub-plan for [Phase 0 — Foundation Hardening](./phase-0-foundation-hardening.md), WS-0.2
step 1. This is PR 1 in the suggested breakdown: the runtime upgrade that must land and
soak on its own before WS-0.2b adds `bunfig.toml` `minimumReleaseAge` (which requires
Bun ≥ 1.2.20).

## Why this is its own PR

The whole repo is Bun-native: package manager, test runner, script runner, the agent
loop, and the sandbox images all run on Bun. A version bump therefore touches every
execution path at once, and any regression it causes should be attributable to a single
small commit rather than buried inside a config change. Landing it alone also means it
can be reverted cheaply.

## Target version

`bun@1.3.14` — current `latest` on the npm registry. Two majors of behavior change from
the pinned `1.2.14`, and comfortably past the `1.2.20` floor that WS-0.2b needs.

## Scope

| Change | File |
| --- | --- |
| `packageManager` pin | `package.json` |
| CI toolchain version | `.github/workflows/ci.yml` (`oven-sh/setup-bun` `bun-version`) |
| Documented version | `docs/agents/code-style.md` |
| Lockfile refresh | `bun.lock` |

**Out of scope (deliberate).**

- `packages/sandbox/providers/docker/Dockerfile` copies `bun` from the floating
  `oven/bun:1` tag. That already tracks the 1.3 line and picks up patch releases without
  a commit; pinning it here would trade automatic security patches for reproducibility,
  which is a separate decision from this bump.
- `bunfig.toml` / `minimumReleaseAge` — that is WS-0.2b, after this soaks.
- Dependency upgrades. The only lockfile movement allowed is what Bun writes when
  reconciling the lockfile with the `package.json` files already committed.

## Pre-existing problems this PR had to absorb

Two failures on the branch predate this bump and both had to be fixed for the acceptance
criteria to be demonstrable at all. Neither was caused by the version change.

### 1. Stale lockfile

`bun install --frozen-lockfile` failed before any version change:

```
error: lockfile had changes, but lockfile is frozen
```

`apps/web/package.json` declares `next@16.2.11` (from the Dependabot bump in `#1`) but
`bun.lock` still recorded the `16.2.1` resolution — the lockfile half of that bump was
lost in a merge. Verified this reproduces under **both** Bun 1.2.14 and 1.3.14, so it is
lockfile drift, not a version artifact.

WS-0.2's acceptance criteria include "`bun install --frozen-lockfile` green in CI", and
this PR cannot demonstrate the new Bun version works without a resolvable lockfile.
Regenerating it is therefore in scope. The resulting diff is confined to the
`next` / `@next/*` entries moving to `16.2.11` — zero non-`next` lines changed.

### 2. Duplicate `serverExternalPackages` in `next.config.ts`

`bun run check` failed on `eslint(no-dupe-keys)`: `apps/web/next.config.ts` declared
`serverExternalPackages` twice, another merge artifact. Both declarations listed the same
three packages in different order, so the later one silently won and behavior was
unaffected — but `bun run ci` could not go green with it present. Removed the earlier
declaration and kept the one whose comment explains *why* each package is external.

## Steps

1. Install Bun 1.3.14 locally and reproduce the frozen-lockfile failure on 1.2.14 to
   confirm the drift predates the bump.
2. Bump `packageManager` to `bun@1.3.14`.
3. Bump `bun-version` in `.github/workflows/ci.yml` to `1.3.14` (string-quoted, so YAML
   does not coerce it).
4. Update the version reference in `docs/agents/code-style.md`.
5. Regenerate `bun.lock` with 1.3.14 (`bun install`), then confirm
   `bun install --frozen-lockfile` is clean.
6. Run `bun run ci` end to end on 1.3.14 — format check, lint, typecheck, isolated tests,
   `db:check`.
7. Record anything surprising in `docs/agents/lessons-learned.md`.

## Acceptance criteria — verified locally on Bun 1.3.14

- [x] `packageManager` and `.github/workflows/ci.yml` name the same Bun version
      (`1.3.14`).
- [x] `bun install --frozen-lockfile` succeeds with no lockfile writes
      (`Checked 1299 installs across 1338 packages (no changes)`).
- [x] `bun run ci` passes — format check, lint, typecheck, isolated tests, `db:check`.
- [x] Lockfile diff contains no dependency changes beyond reconciling the committed
      `package.json` files (every changed line is a `next` / `@next/*` entry).
- [x] Bun version is ≥ 1.2.20, unblocking WS-0.2b.

Still open, because CI does not cover it (see Risk): `next build` and the sandbox
providers against live infrastructure. Those are what the soak is for.

## Risk & rollback

Bun 1.2 → 1.3 changes the runtime, bundler, and test runner. `bun run ci` covers lint,
types, and the test suite, but not `next build` (CI does not build today — that gap is
WS-0.4) and not sandbox providers against live infrastructure. Those are the paths to
watch during the soak.

Rollback is reverting this commit; nothing else depends on the new version until
WS-0.2b lands.

## Follow-ups this PR does not do

- **WS-0.2b** — `bunfig.toml` with `minimumReleaseAge = 604800`, after the soak.
- **Lockfile drift guard.** Nothing catches a `package.json` change that skips the
  lockfile until `--frozen-lockfile` fails in CI, and this drift sat on the branch
  unnoticed. A cheap fix belongs in WS-0.4's CI split.
- **Dockerfile Bun pinning.** Decide explicitly whether sandbox images track `oven/bun:1`
  or a pinned digest.
