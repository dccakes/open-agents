import { describe, expect, test } from "bun:test";

/**
 * What workflow code may import at the top level.
 *
 * Anything a workflow module imports statically is loaded into the workflow VM,
 * where `require` does not exist and `next/headers` means nothing. Two families
 * break it: the `ai` runtime (transitive CJS dependencies — see the warning in
 * `app/api/chat/_lib/persist-tool-results.ts`) and the authenticated-request
 * chain that `lib/org/settings` reaches through `lib/auth/require-permission`.
 *
 * A third family is the database: anything reaching `lib/db/client` pulls in
 * `postgres`, and the workflow compiler rejects it at build time with "You are
 * attempting to use \"postgres\" which depends on Node.js modules".
 *
 * The database case has a subtlety worth stating, because it is what broke the
 * group 4 deploy. Plenty of workflow modules import `@/lib/db/*` statically and
 * build fine — `chat.ts` and `chat-post-finish.ts` both do. What matters is
 * *where the value is referenced*: a reference from inside a `"use step"` body
 * is extracted into the step bundle, where Node modules are fine, while a
 * reference from a plain (non-step) function in a workflow module stays in the
 * workflow bundle, where they are not. `buildRunPolicyOptions` is such a plain
 * function, so its database-reaching imports had to become dynamic even though
 * its only caller is a step.
 *
 * These fail at deploy or at runtime rather than at typecheck, so the boundary
 * is pinned as a source check instead of being left to review. The list is a
 * proxy for the real invariant, so when a new module trips the build, add it
 * here rather than only fixing the import.
 */

const WORKFLOW_MODULES = [
  "chat.ts",
  "chat-run-policy.ts",
  "chat-run-budget.ts",
  "chat-run-record.ts",
  "chat-app-side-effects.ts",
] as const;

/** Modules whose *runtime* import must not appear at a workflow module's top level. */
const FORBIDDEN_STATIC_IMPORTS = [
  "@open-agents/agent",
  "@/lib/org/settings",
  "@/lib/budget/daily-budget",
  "@/lib/auth/require-permission",
  "next/headers",
  // Reaches the approval persistence layer, and through it the authenticated
  // request chain. `chat-app-side-effects.ts` imports it inside its step.
  "@/lib/policy/app-side-effect-approvals",
  // Reaches `require-permission` for the session actor, and the sandbox.
  "@/lib/policy/app-side-effect-execution",
  // All three reach `lib/db/client`, and through it `postgres`. This is how the
  // group 4 deploy broke: the values were only used inside a step, but the
  // static import still landed in the workflow bundle.
  "@/lib/policy/session-policy",
  "@/lib/policy/policy-event-recorder",
  "@/lib/policy/approval-gate",
];

/** Static import statements, with `import type` removed. */
function runtimeImportSources(source: string): string[] {
  const sources: string[] = [];
  const importPattern = /^import\s+([\s\S]*?)from\s+"([^"]+)";$/gm;

  for (const match of source.matchAll(importPattern)) {
    const clause = match[1] ?? "";
    const specifier = match[2] ?? "";
    // `import type { … }` is erased at build time and costs the VM nothing.
    if (clause.trimStart().startsWith("type ")) {
      continue;
    }
    sources.push(specifier);
  }

  return sources;
}

describe("workflow module import boundary", () => {
  for (const moduleName of WORKFLOW_MODULES) {
    test(`${moduleName} imports nothing that breaks the workflow VM`, async () => {
      const source = await Bun.file(
        new URL(moduleName, import.meta.url).pathname,
      ).text();

      expect(runtimeImportSources(source)).not.toContainAnyValues(
        FORBIDDEN_STATIC_IMPORTS,
      );
    });
  }

  test("the check can tell a type import from a runtime one", () => {
    const sources = runtimeImportSources(
      [
        'import type { Thing } from "@open-agents/agent";',
        'import { other } from "@/lib/budget/run-budget";',
      ].join("\n"),
    );

    expect(sources).toEqual(["@/lib/budget/run-budget"]);
  });
});
