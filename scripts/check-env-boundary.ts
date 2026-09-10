/**
 * Fail the build when the environment is read outside the config boundary.
 *
 * Every variable belongs to a config module (`apps/web/lib/config/**` or a
 * package's `config.ts`), so the surface is discoverable and validated at boot.
 * Ultracite's oxlint build has no `no-restricted-syntax`, so this script stands
 * in for a lint rule; swap it out if that rule ever lands.
 *
 * Usage:  bun run scripts/check-env-boundary.ts
 */

const SCAN_PATTERNS = ["apps/**/*.ts", "apps/**/*.tsx", "packages/**/*.ts"];

const IGNORED_PATH_SEGMENTS = ["node_modules/", ".next/", "dist/"];

/**
 * Files permitted to read the environment directly.
 *
 * Note the config-module entries are deliberately narrow: a blanket
 * `**\/config.ts` would also exempt `lib/auth/config.ts` and
 * `lib/sandbox/config.ts`, which are feature modules that happen to be named
 * "config" — exactly the files the boundary exists to keep clean.
 */
const ALLOWLIST = [
  // the config boundary itself
  "apps/web/lib/config/**",
  "packages/*/config.ts",
  // tests exercise env-dependent behavior directly
  "**/*.test.ts",
  "**/*.test.tsx",
  // run outside the Next.js runtime, so they cannot import app modules
  "apps/web/drizzle.config.ts",
  "apps/web/next.config.ts",
  "apps/web/lib/db/migrate.ts",
  // boot validation entry points
  "apps/web/instrumentation.ts",
  "apps/web/instrumentation-client.ts",
  // build/CI tooling
  "scripts/**",
  "apps/web/scripts/**",
];

const ENV_ACCESS_PATTERN = /\b(?:process|Bun)\.env\b/;

interface Violation {
  file: string;
  line: number;
  text: string;
}

function isIgnored(path: string): boolean {
  return IGNORED_PATH_SEGMENTS.some((segment) => path.includes(segment));
}

function isAllowlisted(path: string): boolean {
  return ALLOWLIST.some((pattern) => new Bun.Glob(pattern).match(path));
}

async function collectFiles(): Promise<string[]> {
  const files = new Set<string>();

  for (const pattern of SCAN_PATTERNS) {
    const glob = new Bun.Glob(pattern);
    for await (const path of glob.scan(".")) {
      if (isIgnored(path) || isAllowlisted(path)) {
        continue;
      }
      files.add(path);
    }
  }

  return [...files].sort((a, b) => a.localeCompare(b));
}

async function findViolations(files: string[]): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const file of files) {
    const contents = await Bun.file(file).text();
    if (!ENV_ACCESS_PATTERN.test(contents)) {
      continue;
    }

    const lines = contents.split("\n");
    for (const [index, line] of lines.entries()) {
      if (ENV_ACCESS_PATTERN.test(line)) {
        violations.push({ file, line: index + 1, text: line.trim() });
      }
    }
  }

  return violations;
}

const files = await collectFiles();
const violations = await findViolations(files);

if (violations.length > 0) {
  console.error(
    `Environment reads outside the config boundary (${violations.length}):\n`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.text}`);
  }
  console.error(
    "\nAdd the variable to a config module instead:" +
      "\n  - apps/web: apps/web/lib/config/<concern>.ts" +
      "\n  - packages: packages/<name>/config.ts" +
      "\nIf the file genuinely runs outside the app runtime, add it to ALLOWLIST" +
      " in scripts/check-env-boundary.ts with a reason.",
  );
  process.exit(1);
}

console.log(`Env boundary clean — scanned ${files.length} files.`);
