import { type LearnStep, learnStepSlug } from "../../data/learn.ts";

export type StepperItem = {
  id: string;
  number: number;
  title: string;
  slug: string;
  current: boolean;
  done: boolean;
};

/** The Learn steps in order, each flagged as the open one and as passed or marked read. */
export const stepperItems = (
  steps: LearnStep[],
  currentId: string,
  isDone: (id: string) => boolean,
): StepperItem[] =>
  steps.map((step, index) => ({
    id: step.id,
    number: index + 1,
    title: step.title,
    slug: learnStepSlug(step),
    current: step.id === currentId,
    done: isDone(step.id),
  }));
