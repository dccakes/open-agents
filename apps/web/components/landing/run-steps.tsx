const STEPS = [
  "Pick a repo",
  "Describe the task",
  "Agent works in a sandbox",
  "PR opens",
] as const;

/**
 * What a run actually does, in one line — enough orientation for someone
 * signing in for the first time.
 */
export function RunSteps() {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-white/45">
      {STEPS.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true">→</span> : null}
          {step}
        </li>
      ))}
    </ol>
  );
}
