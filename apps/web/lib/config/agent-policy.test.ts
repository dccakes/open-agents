import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  agentPolicyEnv,
  DEFAULT_APPROVAL_TIMEOUT_HOURS,
  DEFAULT_RUN_STEP_BUDGET,
  getAgentPolicyConfig,
  getApprovalTimeoutMs,
  getRunStepBudget,
  getRunTokenBudget,
} from "@/lib/config/agent-policy";

const TRACKED_KEYS = [
  "AGENT_APPROVAL_TIMEOUT_HOURS",
  "AGENT_RUN_STEP_BUDGET",
  "AGENT_RUN_TOKEN_BUDGET",
] as const;

const originalValues = new Map(
  TRACKED_KEYS.map((key) => [key, process.env[key]]),
);

function setEnv(
  values: Partial<Record<(typeof TRACKED_KEYS)[number], string>>,
) {
  for (const key of TRACKED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

beforeEach(() => {
  setEnv({});
});

afterEach(() => {
  for (const [key, value] of originalValues) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("agentPolicyEnv specs", () => {
  test("every variable is optional, so an unset deployment still boots", () => {
    for (const key of TRACKED_KEYS) {
      expect(agentPolicyEnv.specs[key].axis).toBe("optional");
    }
  });

  test("every variable carries a one-line description", () => {
    for (const key of TRACKED_KEYS) {
      expect(agentPolicyEnv.specs[key].description.length).toBeGreaterThan(0);
    }
  });
});

describe("AGENT_APPROVAL_TIMEOUT_HOURS", () => {
  test("defaults to 24 hours when unset", () => {
    expect(getAgentPolicyConfig().approvalTimeoutHours).toBe(
      DEFAULT_APPROVAL_TIMEOUT_HOURS,
    );
    expect(DEFAULT_APPROVAL_TIMEOUT_HOURS).toBe(24);
  });

  test("parses a configured positive integer", () => {
    setEnv({ AGENT_APPROVAL_TIMEOUT_HOURS: "6" });

    expect(getAgentPolicyConfig().approvalTimeoutHours).toBe(6);
  });

  test("exposes the timeout in milliseconds", () => {
    setEnv({ AGENT_APPROVAL_TIMEOUT_HOURS: "2" });

    expect(getApprovalTimeoutMs()).toBe(2 * 60 * 60 * 1000);
  });

  test("rejects a non-numeric value rather than silently defaulting", () => {
    setEnv({ AGENT_APPROVAL_TIMEOUT_HOURS: "soon" });

    expect(() => getAgentPolicyConfig()).toThrow();
  });

  test("rejects zero and negative timeouts", () => {
    setEnv({ AGENT_APPROVAL_TIMEOUT_HOURS: "0" });
    expect(() => getAgentPolicyConfig()).toThrow();

    setEnv({ AGENT_APPROVAL_TIMEOUT_HOURS: "-1" });
    expect(() => getAgentPolicyConfig()).toThrow();
  });
});

describe("AGENT_RUN_STEP_BUDGET", () => {
  test("defaults to the step ceiling the chat route used before it was configurable", () => {
    expect(getRunStepBudget()).toBe(DEFAULT_RUN_STEP_BUDGET);
    expect(DEFAULT_RUN_STEP_BUDGET).toBe(500);
  });

  test("parses a configured positive integer", () => {
    setEnv({ AGENT_RUN_STEP_BUDGET: "40" });

    expect(getRunStepBudget()).toBe(40);
  });

  test("rejects a fractional budget", () => {
    setEnv({ AGENT_RUN_STEP_BUDGET: "12.5" });

    expect(() => getRunStepBudget()).toThrow();
  });
});

describe("AGENT_RUN_TOKEN_BUDGET", () => {
  test("is unlimited when unset, so no deployment gains a guessed ceiling", () => {
    expect(getRunTokenBudget()).toEqual({ limit: "unlimited" });
  });

  test("reports a configured ceiling as an explicit limited budget", () => {
    setEnv({ AGENT_RUN_TOKEN_BUDGET: "250000" });

    expect(getRunTokenBudget()).toEqual({
      limit: "limited",
      tokens: 250_000,
    });
  });

  test("rejects a non-numeric ceiling", () => {
    setEnv({ AGENT_RUN_TOKEN_BUDGET: "lots" });

    expect(() => getRunTokenBudget()).toThrow();
  });
});
