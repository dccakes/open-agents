export type RunStep = {
  readonly step: string;
  readonly title: string;
  readonly detail: string;
  readonly tint: string;
};

/**
 * What actually happens on a QuackOps run, in order. Mirrors the four-card
 * band on withpickle.com, but describes the pipeline rather than metrics.
 */
export const RUN_LIFECYCLE: readonly RunStep[] = [
  {
    step: "01",
    title: "Pick a repo",
    detail: "Any repo the Pickle GitHub App can reach",
    tint: "hsl(79 70% 72%)",
  },
  {
    step: "02",
    title: "Describe the task",
    detail: "A ticket, a bug, a refactor — plain language",
    tint: "hsl(173 60% 62%)",
  },
  {
    step: "03",
    title: "Agent works",
    detail: "Isolated sandbox, full shell, real test runs",
    tint: "hsl(38 92% 68%)",
  },
  {
    step: "04",
    title: "PR lands",
    detail: "Branch pushed, diff cached, PR opened for review",
    tint: "hsl(178 45% 62%)",
  },
];
