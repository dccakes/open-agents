import { describe, expect, test } from "bun:test";
import { policyCallOptionsSchema, resolvePolicyContext } from "./call-options";
import { defaultCommandPolicy } from "./default-policy";
import { readOnlyPolicy } from "./read-only-policy";

describe("policyCallOptionsSchema", () => {
  test("accepts an empty object and a full one", () => {
    expect(policyCallOptionsSchema.safeParse({}).success).toBe(true);
    expect(
      policyCallOptionsSchema.safeParse({
        policy: readOnlyPolicy,
        posture: "strict",
        policyEventRecorder: { record: () => undefined },
      }).success,
    ).toBe(true);
  });

  test("rejects an unknown posture", () => {
    expect(policyCallOptionsSchema.safeParse({ posture: "yolo" }).success).toBe(
      false,
    );
  });
});

describe("resolvePolicyContext", () => {
  test("forwards the supplied policy and posture", () => {
    const context = resolvePolicyContext({
      policy: readOnlyPolicy,
      posture: "strict",
    });

    expect(context.policy.id).toBe(readOnlyPolicy.id);
    expect(context.posture).toBe("strict");
    expect(context.interactive).toBe(true);
  });

  test("falls back to the shipped baseline under auto", () => {
    const context = resolvePolicyContext({});

    expect(context.policy.id).toBe(defaultCommandPolicy.id);
    expect(context.posture).toBe("auto");
  });

  test("carries the injected recorder", () => {
    const recorder = { record: () => undefined };
    expect(
      resolvePolicyContext({ policyEventRecorder: recorder }).recorder,
    ).toBe(recorder);
  });

  test("can be marked non-interactive", () => {
    expect(resolvePolicyContext({}, { interactive: false }).interactive).toBe(
      false,
    );
  });
});
