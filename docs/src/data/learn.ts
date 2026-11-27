export type LearnStep = {
  id: string;
  title: string;
  minutes: number;
  summary: string;
  group: "essentials" | "shaping-chains";
};

export const learnSteps: LearnStep[] = [
  {
    id: "first-chain",
    title: "Your first chain",
    minutes: 2,
    summary: "Define a job type, start a chain and let a worker process it.",
    group: "essentials",
  },
  {
    id: "transactional-outbox",
    title: "Transactional outbox",
    minutes: 3,
    summary:
      "Start a chain in the transaction that saves your data, so neither exists without the other.",
    group: "essentials",
  },
  {
    id: "errors-and-retries",
    title: "Errors and retries",
    minutes: 3,
    summary: "A job that throws or whose worker dies goes back to pending and runs again.",
    group: "essentials",
  },
  {
    id: "transactional-completion",
    title: "Transactional completion",
    minutes: 3,
    summary:
      "Complete a job in the transaction that writes its result, so a retry never applies it twice.",
    group: "essentials",
  },
  {
    id: "continuing-a-chain",
    title: "Continuing a chain",
    minutes: 4,
    summary: "Hand a chain from one job to the next with continueWith, and branch at runtime.",
    group: "shaping-chains",
  },
  {
    id: "job-blockers",
    title: "Job blockers",
    minutes: 4,
    summary: "Make a job wait until other chains complete.",
    group: "shaping-chains",
  },
];

export const learnGroups: { id: LearnStep["group"]; intro: string }[] = [
  {
    id: "essentials",
    intro: "How a chain runs and what Queuert guarantees about it.",
  },
  {
    id: "shaping-chains",
    intro: "Chains of several jobs, and jobs that wait for other chains.",
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
    slug: "guides/chain-patterns",
    title: "Chain patterns",
    summary: "Loops, go-to jumps and other chain shapes.",
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
