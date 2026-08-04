import { describe, expect, test } from "bun:test";
import { describeApprovalPause } from "./approval-policy-context";

/**
 * A paused tool call has to say what paused it. The tool and the operation are
 * already on the tool row; this is the posture, which is not otherwise visible
 * from inside the transcript.
 */
describe("describeApprovalPause", () => {
  test("names the posture that caused the pause", () => {
    const notice = describeApprovalPause("strict");

    expect(notice).toContain("strict");
    expect(notice?.toLowerCase()).toContain("approval");
  });

  test("says nothing where the posture is not known", () => {
    expect(describeApprovalPause(null)).toBeNull();
  });
});
