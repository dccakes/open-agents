import { describe, expect, test } from "bun:test";
import { evaluate } from "./command-policy";
import { defaultCommandPolicy } from "./default-policy";
import {
  type CorpusTag,
  GOLDEN_CORPUS,
  type CorpusEntry,
} from "./golden-corpus";
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
  // The command-level invariant lives in `absorbed-denylist.test.ts`; here it
  // is checked over the corpus, whose `legacy`-tagged entries are exactly the
  // families the pre-policy denylist covered.
  test("no legacy-tagged corpus command is allowed under auto", () => {
    const legacy = GOLDEN_CORPUS.filter((entry) =>
      entry.tags.includes("legacy"),
    );
    expect(legacy.length).toBeGreaterThan(0);

    for (const entry of legacy) {
      expect(decisionFor(entry, "auto").action).not.toBe("allow");
    }
  });
});
