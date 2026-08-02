/**
 * Optional deployment override for the default sandbox lifetime.
 *
 * `VERCEL_SANDBOX_TIMEOUT_MS` is documented in `.env.example` and declared in
 * `turbo.json`, but the code that read it was removed along with the Hobby-plan
 * workarounds. It is parsed here so the documented variable takes effect again,
 * and ignored when it is unset, non-numeric, or out of range.
 */

/**
 * Parse a sandbox timeout override.
 *
 * @param rawValue Raw environment value, if any.
 * @param maxMs Upper bound accepted by the sandbox provider.
 * @returns The override in milliseconds, or `null` when it should be ignored.
 */
export function parseSandboxTimeoutOverrideMs(
  rawValue: string | undefined,
  maxMs: number,
): number | null {
  const trimmed = rawValue?.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[sandbox] ignoring invalid VERCEL_SANDBOX_TIMEOUT_MS: ${trimmed}`,
    );
    return null;
  }

  const timeoutMs = Math.floor(parsed);
  if (timeoutMs > maxMs) {
    console.warn(
      `[sandbox] clamping VERCEL_SANDBOX_TIMEOUT_MS (${timeoutMs}) to the maximum supported sandbox lifetime (${maxMs})`,
    );
    return maxMs;
  }

  return timeoutMs;
}

/** Read the sandbox timeout override from the environment. */
export function getSandboxTimeoutOverrideMs(maxMs: number): number | null {
  return parseSandboxTimeoutOverrideMs(
    process.env.VERCEL_SANDBOX_TIMEOUT_MS,
    maxMs,
  );
}
