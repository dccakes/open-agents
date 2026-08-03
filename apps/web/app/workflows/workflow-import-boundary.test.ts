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
 * Both are reachable from this change's modules by an obvious-looking import,
 * and both fail at runtime rather than at typecheck, so the boundary is pinned
 * as a source check instead of being left to review.
 */

const WORKFLOW_MODULES = [
  "chat.ts",
  "chat-run-policy.ts",
  "chat-run-budget.ts",
  "chat-run-record.ts",
] as const;

/** Modules whose *runtime* import must not appear at a workflow module's top level. */
const FORBIDDEN_STATIC_IMPORTS = [
  "@open-agents/agent",
  "@/lib/org/settings",
  "@/lib/budget/daily-budget",
  "@/lib/auth/require-permission",
  "next/headers",
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
