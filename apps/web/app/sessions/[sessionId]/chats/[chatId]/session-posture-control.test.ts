import { describe, expect, test } from "bun:test";
import {
  POSTURE_CHANGE_NOTICE,
  describePosture,
  shouldShowDangerousBadge,
} from "./session-posture-control";

describe("describePosture", () => {
  test("says what strict does", () => {
    const described = describePosture("strict");

    expect(described.label).toBe("Strict");
    expect(described.description.toLowerCase()).toContain("approval");
  });

  test("says that auto lets the policy decide", () => {
    expect(describePosture("auto").description.toLowerCase()).toContain(
      "policy",
    );
  });

  test("says that dangerous never bypasses a denial", () => {
    const described = describePosture("dangerous");

    expect(described.description.toLowerCase()).toContain("denied");
    expect(described.tone).toBe("danger");
  });
});

describe("POSTURE_CHANGE_NOTICE", () => {
  /**
   * The spec is explicit that the UI must state this: a posture change is not
   * a kill switch, and a user who tightens the posture to stop a run in flight
   * needs to know it will not.
   */
  test("states that a change applies to what comes next and stops nothing", () => {
    const notice = POSTURE_CHANGE_NOTICE.toLowerCase();

    expect(notice).toContain("subsequent");
    expect(notice).toContain("does not stop a run");
  });
});

describe("shouldShowDangerousBadge", () => {
  test("marks a dangerous session persistently", () => {
    expect(shouldShowDangerousBadge("dangerous")).toBe(true);
  });

  test("marks nothing else", () => {
    expect(shouldShowDangerousBadge("strict")).toBe(false);
    expect(shouldShowDangerousBadge("auto")).toBe(false);
    expect(shouldShowDangerousBadge(null)).toBe(false);
  });
});
