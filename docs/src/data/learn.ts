export type LearnStep = { id: string; title: string; minutes: number; summary: string };

export const learnSteps: LearnStep[] = [
  {
    id: "first-chain",
    title: "Your first chain",
    minutes: 2,
    summary: "Define a job type, start a chain and let a worker process it.",
  },
  {
    id: "chains-in-your-transaction",
    title: "Chains in your transaction",
    minutes: 3,
    summary: "Start a chain next to your own write so both commit or roll back together.",
  },
  {
    id: "continuing-a-chain",
    title: "Continuing a chain",
    minutes: 3,
    summary: "Hand a chain from one job to the next with continueWith.",
  },
  {
    id: "branching",
    title: "Branching",
    minutes: 3,
    summary: "Pick the next job at runtime.",
  },
  {
    id: "errors-and-retries",
    title: "Errors and retries",
    minutes: 4,
    summary: "Throw, go back to pending and retry with backoff.",
  },
];

export const useItInYourApp = {
  slug: "learn/use-it-in-your-app",
  title: "Use it in your app",
  summary: "Install Queuert with your database, migrate the schema and run chains on it.",
};

export const learnStepSlug = (step: LearnStep): string => `learn/${step.id}`;

export const goFurther: { slug: string; title: string; summary: string }[] = [
  {
    slug: "guides/job-blockers",
    title: "Job blockers",
    summary: "Make a job wait for other chains to complete before it starts.",
  },
  {
    slug: "guides/scheduling",
    title: "Scheduling",
    summary: "Start a chain later, or reschedule a job from inside its handler.",
  },
  {
    slug: "guides/deduplication",
    title: "Deduplication",
    summary: "Keep a repeated trigger from queuing the same chain twice.",
  },
  {
    slug: "guides/chain-awaiting",
    title: "Awaiting chains",
    summary: "Wait for a chain to finish from your own code.",
  },
  {
    slug: "guides/workerless-outcomes",
    title: "Workerless outcomes",
    summary: "Complete or continue a job from outside a worker.",
  },
  {
    slug: "guides/batched-processors",
    title: "Batched processors",
    summary: "Process many jobs of one type in a single pass.",
  },
  {
    slug: "guides/timeouts",
    title: "Timeouts",
    summary: "Bound how long an attempt may run before it is abandoned.",
  },
];
