import { describe, expect, test } from "bun:test";
import {
  approvalExpiresAt,
  effectiveApprovalDecision,
  isApprovalDenied,
  isApprovalSpendable,
} from "@/lib/policy/approval-state";

const NOW = new Date("2026-08-03T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function row(overrides: {
  decision: "pending" | "approved" | "denied" | "expired";
  expiresAt?: Date;
  consumedAt?: Date | null;
}) {
  return {
    decision: overrides.decision,
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + HOUR),
    consumedAt: overrides.consumedAt ?? null,
  };
}

describe("effectiveApprovalDecision", () => {
  test("reports a live pending approval as pending", () => {
    expect(effectiveApprovalDecision(row({ decision: "pending" }), NOW)).toBe(
      "pending",
    );
  });

  /**
   * The security property: expiry is computed on read, in every environment,
   * whether or not the sweeper has ever run. A deployment where the cron is
   * broken must still time approvals out.
   */
  test("reports a pending approval past its expiry as expired", () => {
    expect(
      effectiveApprovalDecision(
        row({ decision: "pending", expiresAt: new Date(NOW.getTime() - 1) }),
        NOW,
      ),
    ).toBe("expired");
  });

  test("reports an approved-but-expired approval as expired, not approved", () => {
    // Approving does not freeze the clock: an approval granted three days ago
    // must not still authorize an execution today.
    expect(
      effectiveApprovalDecision(
        row({
          decision: "approved",
          expiresAt: new Date(NOW.getTime() - HOUR),
        }),
        NOW,
      ),
    ).toBe("expired");
  });

  test("keeps an explicit denial a denial even past expiry", () => {
    expect(
      effectiveApprovalDecision(
        row({ decision: "denied", expiresAt: new Date(NOW.getTime() - HOUR) }),
        NOW,
      ),
    ).toBe("denied");
  });

  test("treats the expiry instant itself as expired", () => {
    expect(
      effectiveApprovalDecision(
        row({ decision: "approved", expiresAt: NOW }),
        NOW,
      ),
    ).toBe("expired");
  });

  test("reports a materialized expired row as expired", () => {
    expect(effectiveApprovalDecision(row({ decision: "expired" }), NOW)).toBe(
      "expired",
    );
  });
});

describe("isApprovalDenied", () => {
  test("an expired approval is a denial, not a re-prompt", () => {
    expect(
      isApprovalDenied(
        row({ decision: "pending", expiresAt: new Date(NOW.getTime() - 1) }),
        NOW,
      ),
    ).toBe(true);
  });

  test("a denied approval is a denial", () => {
    expect(isApprovalDenied(row({ decision: "denied" }), NOW)).toBe(true);
  });

  test("a live pending approval is not yet a denial", () => {
    expect(isApprovalDenied(row({ decision: "pending" }), NOW)).toBe(false);
  });

  test("a live approved approval is not a denial", () => {
    expect(isApprovalDenied(row({ decision: "approved" }), NOW)).toBe(false);
  });
});

describe("isApprovalSpendable", () => {
  test("a live, approved, unconsumed approval may be spent", () => {
    expect(isApprovalSpendable(row({ decision: "approved" }), NOW)).toBe(true);
  });

  test("an already-consumed approval may not be spent again", () => {
    expect(
      isApprovalSpendable(
        row({ decision: "approved", consumedAt: new Date(NOW.getTime() - 60) }),
        NOW,
      ),
    ).toBe(false);
  });

  test("a pending approval may not be spent", () => {
    expect(isApprovalSpendable(row({ decision: "pending" }), NOW)).toBe(false);
  });

  test("an expired approval may not be spent", () => {
    expect(
      isApprovalSpendable(
        row({ decision: "approved", expiresAt: new Date(NOW.getTime() - 1) }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("approvalExpiresAt", () => {
  test("is the configured timeout after the creation instant", () => {
    const expiresAt = approvalExpiresAt(NOW);

    // Default is 24 hours; the config test pins the default itself.
    expect(expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 24 * HOUR);
  });
});
