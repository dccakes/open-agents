import { describe, expect, test } from "bun:test";
import {
  isInteractiveTrigger,
  NON_INTERACTIVE_DANGEROUS_REASON,
  resolvePosture,
  runTriggerSchema,
} from "@/lib/policy/posture-resolution";

describe("run triggers", () => {
  test("names every way a run can start", () => {
    expect(runTriggerSchema.options).toEqual([
      "interactive",
      "webhook",
      "schedule",
      "system",
    ]);
  });

  test("only an interactive trigger has a human who could approve", () => {
    expect(isInteractiveTrigger("interactive")).toBe(true);
    expect(isInteractiveTrigger("webhook")).toBe(false);
    expect(isInteractiveTrigger("schedule")).toBe(false);
    expect(isInteractiveTrigger("system")).toBe(false);
  });
});

describe("resolvePosture", () => {
  test("passes an interactive posture through unchanged", () => {
    for (const posture of ["strict", "auto", "dangerous"] as const) {
      expect(
        resolvePosture({ stored: posture, trigger: "interactive" }),
      ).toEqual({
        posture,
        requested: posture,
        downgraded: false,
      });
    }
  });

  test("refuses dangerous for a webhook trigger and falls back to auto", () => {
    const resolution = resolvePosture({
      stored: "dangerous",
      trigger: "webhook",
    });

    expect(resolution.posture).toBe("auto");
    expect(resolution.requested).toBe("dangerous");
    expect(resolution.downgraded).toBe(true);
    expect(resolution.reason).toBe(NON_INTERACTIVE_DANGEROUS_REASON);
  });

  /**
   * The refusal lives in the resolution helper rather than in the webhook
   * handler, so a trigger added later is covered without anybody remembering.
   */
  test("refuses dangerous for every non-interactive trigger", () => {
    for (const trigger of ["webhook", "schedule", "system"] as const) {
      const resolution = resolvePosture({ stored: "dangerous", trigger });

      expect(resolution.posture).toBe("auto");
      expect(resolution.downgraded).toBe(true);
    }
  });

  test("leaves strict alone for a non-interactive trigger", () => {
    // Downgrading only ever relaxes, so tightening must never be undone.
    expect(resolvePosture({ stored: "strict", trigger: "webhook" })).toEqual({
      posture: "strict",
      requested: "strict",
      downgraded: false,
    });
  });

  test("falls back to auto when the stored value is not a posture", () => {
    const resolution = resolvePosture({
      stored: "extremely-dangerous",
      trigger: "interactive",
    });

    expect(resolution.posture).toBe("auto");
    expect(resolution.downgraded).toBe(true);
  });

  test("falls back to auto when nothing is stored", () => {
    expect(
      resolvePosture({ stored: null, trigger: "interactive" }).posture,
    ).toBe("auto");
    expect(
      resolvePosture({ stored: undefined, trigger: "interactive" }).posture,
    ).toBe("auto");
  });
});
