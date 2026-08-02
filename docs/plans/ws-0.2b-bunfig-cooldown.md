# WS-0.2b — Supply-chain cooldown (`bunfig.toml` `minimumReleaseAge`)

Sub-plan for [Phase 0 — Foundation Hardening](./phase-0-foundation-hardening.md), WS-0.2
steps 2–5. This is PR 2 in the suggested breakdown, after
[WS-0.2a](./ws-0.2a-bun-version-bump.md) landed the Bun `1.3.14` bump that clears the
`1.2.20` floor this feature needs.

## What landed

Root `bunfig.toml`:

```toml
[install]
minimumReleaseAge = 604800            # 7 days
minimumReleaseAgeExcludes = ["@daytonaio/sdk"]
```

The file itself is kept bare — the rationale, the protection window, and the justification
for the one exclusion live in this document rather than in inline comments. Nothing else
changed: `bun.lock` is byte-identical after installing under the new config.

## Verified behavior (Bun 1.3.14, against the live npm registry)

Bun's documentation describes the setting but not its failure modes, so each was tested
directly. `@types/node` was the probe: `26.1.2` published 2026-07-27 (inside the window on
the test date, 2026-08-02) and `26.1.1` published 2026-07-08 (outside it).

| Scenario | Result |
| --- | --- |
| `bun add @types/node`, no `bunfig.toml` | resolves `26.1.2` (control) |
| same, with `minimumReleaseAge = 604800` | resolves `26.1.1` — silently held back, **no warning or error** |
| same, plus `minimumReleaseAgeExcludes = ["@types/node"]` | resolves `26.1.2` — escape hatch works, and works for scoped names |
| `bun add` run from `apps/web` with the cooldown only at the repo root | resolves `26.1.1` — root config applies to workspace-subdirectory installs |
| range with **no** version old enough | hard `error: No version matching … (blocked by minimum-release-age: 604800 seconds)`, exit 1 |

Two findings worth carrying forward:

1. **The normal case is silent, not loud.** Plan step 3 anticipated a block or a warning.
   What actually happens is a quiet downgrade to the newest eligible version. A cooldown
   hit is therefore visible only as an older-than-expected version in a lockfile diff —
   worth knowing when a `bun update` appears to have done nothing.
2. **The loud case is a total install failure.** When every version in a range is inside
   the window, resolution fails outright rather than falling back, and it takes the whole
   `bun install` down with it — including `--frozen-lockfile`. That is what the exclusion
   below is for.

## Why `@daytonaio/sdk` is excluded

Adding the cooldown broke `bun install` in this repo immediately, frozen and non-frozen
alike:

```
error: No version matching "@daytonaio/sdk" found for specifier "^0.203.0"
       (blocked by minimum-release-age: 604800 seconds)
error: @daytonaio/sdk@^0.203.0 failed to resolve
```

`packages/sandbox` depends on `@daytonaio/sdk@^0.203.0`. Caret ranges on `0.x` versions
pin the minor, so `^0.203.0` is `>=0.203.0 <0.204.0` — and Daytona ships a new `0.x` minor
every few days (`0.200.0` 07-21, `0.200.1` 07-22, `0.201.0` 07-27, `0.202.0` 07-29,
`0.203.0` 07-31). The range contains exactly one published version, `0.203.0`, two days old
on the date this landed. No eligible version exists, so resolution has nothing to fall back
to.

Note this fires even though `bun.lock` already pins `0.203.0` — the cooldown is applied
during resolution, and an install whose config just changed re-resolves. So this is not a
condition that waits for someone to run `bun update`; it breaks CI on the commit that adds
the cooldown.

Options considered:

- **Exclude the package** (chosen). Restores `bun install`, keeps the cooldown for the
  other ~1300 packages, and is a one-line, reversible change.
- **Wait for `0.203.0` to age out** (2026-08-07). Fixes today's symptom and none of the
  cause — the next Daytona release re-breaks it, and CI would be red until then.
- **Downgrade to an aged version** (`^0.200.1`). Changes a dependency's behavior inside a
  config-only PR, and still re-breaks on the next bump.

The exclusion is not an assertion that Daytona is trustworthy. It records that a cooldown
cannot be expressed for a package whose caret range is a single days-old release. Anything
added to `minimumReleaseAgeExcludes` — including the urgent-security-patch case the escape
hatch exists for — should be justified here and given a removal path, since the file
carries no inline explanation.

**Follow-up:** widen or pin the `@daytonaio/sdk` range in `packages/sandbox/package.json`
so an aged version is reachable (for example `>=0.200.1`, or an exact pin bumped
deliberately), then drop the exclusion. Worth pairing with the decision about whether the
optional Daytona provider should be a hard dependency of `packages/sandbox` at all.

## Honest limits of the protection

- **Entry, not residency.** The cooldown gates the moment a version is chosen. A version
  already pinned in `bun.lock` is installed as-is; if a compromised version made it in, it
  stays until someone updates it.
- **Excluded packages are entirely unprotected** for as long as they are listed — hence
  the requirement that every entry carry a justification and a removal path.
- **Nothing enforces the config.** A contributor running `bun install --no-config`, or
  installing from a directory outside the repo, bypasses it. This is a default, not a
  control.
- **Dependency bumps get slower, deliberately.** Dependabot PRs that pin a release younger
  than 7 days will fail to install until the release ages or the range admits an older
  version. That friction is the feature, but it is friction.

## Acceptance criteria

- [x] `bunfig.toml` committed at the repo root with `minimumReleaseAge = 604800`.
- [x] Enforcement verified against the live registry (table above), including the escape
      hatch and workspace-subdirectory behavior.
- [x] Escape hatch documented, with the one live exclusion justified and given a removal
      path. Plan steps 4 and 5 asked for this as `bunfig.toml` comments; it lives in this
      document instead, to keep the config file bare.
- [x] The protection window described honestly (see above).
- [x] `bun install --frozen-lockfile` clean, with no `bun.lock` diff
      (`Checked 1299 installs across 1338 packages (no changes)`).
- [x] `bun run ci` green.
