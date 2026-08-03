import { describe, expect, test } from "bun:test";
import { evaluate } from "./command-policy";
import { defaultCommandPolicy } from "./default-policy";
import { GOLDEN_CORPUS } from "./golden-corpus";
import { readOnlyPolicy } from "./read-only-policy";
import type { CommandPolicy, Posture } from "./types";

/**
 * The latency budget applies to `evaluate()` — parse plus match, no I/O. It
 * deliberately does not cover the rest of an approval chain: `write`/`edit`
 * approval performs a sandbox `realpath` round trip, which is a network call
 * and can never meet a 5 ms bound.
 */
const P95_BUDGET_MS = 5;
const WARMUP_ROUNDS = 3;

function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(fraction * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)] ?? 0;
}

function measure(policy: CommandPolicy, posture: Posture): number[] {
  for (let round = 0; round < WARMUP_ROUNDS; round += 1) {
    for (const entry of GOLDEN_CORPUS) {
      evaluate({ toolName: "bash", command: entry.command }, policy, posture);
    }
  }

  return GOLDEN_CORPUS.map((entry) => {
    const started = performance.now();
    evaluate({ toolName: "bash", command: entry.command }, policy, posture);
    return performance.now() - started;
  });
}

describe("policy evaluation latency", () => {
  test("p95 over the golden corpus is under 5 ms with the baseline", () => {
    const samples = measure(defaultCommandPolicy, "auto");
    const p95 = percentile(samples, 0.95);
    // Reported so a regression shows the number, not just a failure.
    console.log(
      `evaluate() p95 ${p95.toFixed(3)} ms, max ${Math.max(...samples).toFixed(3)} ms over ${samples.length} commands`,
    );
    expect(p95).toBeLessThan(P95_BUDGET_MS);
  });

  test("p95 is under 5 ms with the read-only profile too", () => {
    expect(percentile(measure(readOnlyPolicy, "strict"), 0.95)).toBeLessThan(
      P95_BUDGET_MS,
    );
  });

  test("a pathological command still evaluates within the budget", () => {
    const pathological = `${"ls && ".repeat(400)}echo done`;
    const started = performance.now();
    evaluate(
      { toolName: "bash", command: pathological },
      defaultCommandPolicy,
      "auto",
    );
    expect(performance.now() - started).toBeLessThan(P95_BUDGET_MS * 10);
  });
});
