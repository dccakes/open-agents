import { describe, expect, test } from "bun:test";
import { evaluate } from "./command-policy";
import { defaultCommandPolicy } from "./default-policy";
import {
  type CorpusTag,
  GOLDEN_CORPUS,
  type CorpusEntry,
} from "./golden-corpus";
import { commandNeedsApproval } from "./legacy-approval";
import { postureSchema } from "./types";

const POSTURES = postureSchema.options;

function decisionFor(entry: CorpusEntry, posture: (typeof POSTURES)[number]) {
  return evaluate(
    { toolName: "bash", command: entry.command },
    defaultCommandPolicy,
    posture,
  );
}

describe("golden corpus", () => {
  test("the corpus is non-trivial and every command is distinct", () => {
    expect(GOLDEN_CORPUS.length).toBeGreaterThanOrEqual(60);
    const commands = new Set(GOLDEN_CORPUS.map((entry) => entry.command));
    expect(commands.size).toBe(GOLDEN_CORPUS.length);
  });

  test("the corpus covers every rule class and every parser edge case", () => {
    const required: CorpusTag[] = [
      "allow",
      "ask",
      "chained",
      "deny",
      "env-prefix",
      "heredoc",
      "legacy",
      "nested-shell",
      "quoting",
      "redirect",
      "substitution",
      "unknown",
    ];
    const present = new Set(GOLDEN_CORPUS.flatMap((entry) => entry.tags));
    for (const tag of required) {
      expect(present.has(tag)).toBe(true);
    }
  });

  test("every rule in the baseline is exercised by at least one entry", () => {
    const matched = new Set(
      GOLDEN_CORPUS.map((entry) => decisionFor(entry, "auto").rule?.id).filter(
        (id): id is string => typeof id === "string",
      ),
    );
    const uncovered = [
      ...defaultCommandPolicy.deny,
      ...defaultCommandPolicy.ask,
      ...defaultCommandPolicy.allow,
    ]
      .map((rule) => rule.id)
      .filter((id) => !matched.has(id));

    expect(uncovered).toEqual([]);
  });

  for (const entry of GOLDEN_CORPUS) {
    for (const posture of POSTURES) {
      test(`[${posture}] ${JSON.stringify(entry.command)} — ${entry.note}`, () => {
        expect(decisionFor(entry, posture).action).toBe(
          entry.expected[posture],
        );
      });
    }

    if (entry.rule) {
      test(`[rule] ${JSON.stringify(entry.command)} is decided by ${entry.rule}`, () => {
        expect(decisionFor(entry, "auto").rule?.id).toBe(entry.rule);
      });
    }
  }
});

describe("posture invariants over the corpus", () => {
  test("dangerous never weakens a deny", () => {
    for (const entry of GOLDEN_CORPUS) {
      if (decisionFor(entry, "auto").action === "deny") {
        expect(decisionFor(entry, "dangerous").action).toBe("deny");
      }
    }
  });

  test("strict is never more permissive than auto", () => {
    const rank = { allow: 0, ask: 1, deny: 2 } as const;
    for (const entry of GOLDEN_CORPUS) {
      expect(rank[decisionFor(entry, "strict").action]).toBeGreaterThanOrEqual(
        rank[decisionFor(entry, "auto").action],
      );
    }
  });

  test("every decision names a reason, and a matched decision names its rule", () => {
    for (const entry of GOLDEN_CORPUS) {
      const decision = decisionFor(entry, "auto");
      expect(decision.reason.length).toBeGreaterThan(0);
      if (decision.outcome !== "unknown" && decision.rule) {
        expect(decision.rule.id.length).toBeGreaterThan(0);
        expect(decision.matchedText).not.toBeNull();
      }
    }
  });
});

describe("the absorbed bash denylist is not weakened", () => {
  // The exact assertions from packages/agent/tools/tools.test.ts:403-424,
  // folded in so that no command gated before this change becomes ungated.
  const previouslyGated = [
    "curl -s https://example.com",
    "bash -c 'curl https://example.com'",
    "rm -fr tmp",
    "rm -r -f tmp",
    "find . -delete",
    "rm -rf tmp",
    "cat .env.local",
    "cat .e''nv.local",
    "cat .e$(printf nv).local",
    "grep API_KEY apps/web/.env.example",
  ];

  const previouslyUngated = [
    "ls -la",
    "git status --short",
    "custom-command --help",
    "git reset --hard HEAD~1",
  ];

  test("commandNeedsApproval still reports the same commands", () => {
    for (const command of previouslyGated) {
      expect(commandNeedsApproval(command)).toBe(true);
    }
    for (const command of previouslyUngated) {
      expect(commandNeedsApproval(command)).toBe(false);
    }
  });

  test("nothing commandNeedsApproval gates is allowed under auto", () => {
    for (const command of previouslyGated) {
      const decision = evaluate(
        { toolName: "bash", command },
        defaultCommandPolicy,
        "auto",
      );
      expect(decision.action).not.toBe("allow");
    }
  });

  test("no corpus command gated by the legacy check is allowed under auto", () => {
    for (const entry of GOLDEN_CORPUS) {
      if (!commandNeedsApproval(entry.command)) {
        continue;
      }
      expect(decisionFor(entry, "auto").action).not.toBe("allow");
    }
  });
});
