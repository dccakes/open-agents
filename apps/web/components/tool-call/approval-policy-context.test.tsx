import { describe, expect, test } from "bun:test";
import type { ToolRenderState } from "@open-agents/shared/lib/tool-state";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ApprovalPolicyProvider,
  describeApprovalPause,
} from "./approval-policy-context";
import { ToolLayout } from "./tool-layout";

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

/**
 * One provider serves the whole transcript. It used to be mounted around every
 * individual tool call, which is a prop with extra machinery; `ToolLayout`
 * reads the posture from context however deeply it is nested, so a single
 * mount around the message list is enough.
 */
describe("ApprovalPolicyProvider", () => {
  const paused: ToolRenderState = {
    running: false,
    interrupted: false,
    denied: false,
    approvalRequested: true,
    isActiveApproval: false,
    approvalId: "call-1",
  };

  test("reaches a paused tool call nested well below the provider", () => {
    const html = renderToStaticMarkup(
      <ApprovalPolicyProvider posture="strict">
        <div>
          <div>
            <ToolLayout name="Bash" summary="rm -rf build" state={paused} />
          </div>
        </div>
      </ApprovalPolicyProvider>,
    );

    expect(html).toContain("strict posture");
  });

  test("says nothing where no provider names a posture", () => {
    const html = renderToStaticMarkup(
      <ToolLayout name="Bash" summary="rm -rf build" state={paused} />,
    );

    expect(html).not.toContain("posture");
  });
});
