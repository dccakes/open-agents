import { designSubagent, prepareDesignCall } from "./design";
import { executorSubagent, prepareExecutorCall } from "./executor";
import { explorerSubagent, prepareExplorerCall } from "./explorer";
import type { SubagentPrepareCall } from "./prepare-call";

/**
 * Every registered subagent must expose its `prepareCall`, because that is the
 * only place the policy reaches its tools — each subagent builds a fresh
 * `experimental_context`, so nothing propagates implicitly. Requiring it here
 * makes a subagent added without policy threading fail to compile, and
 * `registry.test.ts` enumerates this map to make it fail at runtime too.
 */
interface SubagentRegistryEntry {
  shortDescription: string;
  agent: unknown;
  prepareCall: SubagentPrepareCall;
  /** Runs under a read-only policy profile. */
  readOnly: boolean;
}

export const SUBAGENT_REGISTRY = {
  explorer: {
    shortDescription:
      "Use for read-only codebase exploration, tracing behavior, and answering questions without changing files",
    agent: explorerSubagent,
    prepareCall: prepareExplorerCall,
    readOnly: true,
  },
  executor: {
    shortDescription:
      "Use for well-scoped implementation work, including edits, scaffolding, refactors, and other file changes",
    agent: executorSubagent,
    prepareCall: prepareExecutorCall,
    readOnly: false,
  },
  design: {
    shortDescription:
      "Use for creating distinctive, production-grade frontend interfaces with high design quality. Generates creative, polished code that avoids generic AI aesthetics.",
    agent: designSubagent,
    prepareCall: prepareDesignCall,
    readOnly: false,
  },
} as const satisfies Record<string, SubagentRegistryEntry>;

export const SUBAGENT_TYPES = Object.keys(SUBAGENT_REGISTRY) as [
  keyof typeof SUBAGENT_REGISTRY,
  ...(keyof typeof SUBAGENT_REGISTRY)[],
];

export type SubagentType = keyof typeof SUBAGENT_REGISTRY;

export function buildSubagentSummaryLines(): string {
  return SUBAGENT_TYPES.map((type) => {
    const subagent = SUBAGENT_REGISTRY[type];
    return `- \`${type}\` - ${subagent.shortDescription}`;
  }).join("\n");
}
