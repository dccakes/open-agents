import { afterEach, describe, expect, test } from "bun:test";
import {
  getSandboxTimeoutOverrideMs,
  parseSandboxTimeoutOverrideMs,
} from "./timeout-override";

const MAX_MS = 5 * 60 * 60 * 1000;

afterEach(() => {
  delete process.env.VERCEL_SANDBOX_TIMEOUT_MS;
});

describe("parseSandboxTimeoutOverrideMs", () => {
  test("returns null when unset or blank", () => {
    expect(parseSandboxTimeoutOverrideMs(undefined, MAX_MS)).toBeNull();
    expect(parseSandboxTimeoutOverrideMs("   ", MAX_MS)).toBeNull();
  });

  test("returns null for non-numeric or non-positive values", () => {
    expect(parseSandboxTimeoutOverrideMs("five hours", MAX_MS)).toBeNull();
    expect(parseSandboxTimeoutOverrideMs("0", MAX_MS)).toBeNull();
    expect(parseSandboxTimeoutOverrideMs("-1000", MAX_MS)).toBeNull();
  });

  test("returns the parsed value when within range", () => {
    expect(parseSandboxTimeoutOverrideMs("1800000", MAX_MS)).toBe(1_800_000);
    expect(parseSandboxTimeoutOverrideMs(" 1800000 ", MAX_MS)).toBe(1_800_000);
  });

  test("clamps values above the provider maximum", () => {
    expect(parseSandboxTimeoutOverrideMs(String(MAX_MS * 2), MAX_MS)).toBe(
      MAX_MS,
    );
  });
});

describe("getSandboxTimeoutOverrideMs", () => {
  test("reads VERCEL_SANDBOX_TIMEOUT_MS from the environment", () => {
    process.env.VERCEL_SANDBOX_TIMEOUT_MS = "600000";
    expect(getSandboxTimeoutOverrideMs(MAX_MS)).toBe(600_000);
  });

  test("returns null when the variable is unset", () => {
    delete process.env.VERCEL_SANDBOX_TIMEOUT_MS;
    expect(getSandboxTimeoutOverrideMs(MAX_MS)).toBeNull();
  });
});
