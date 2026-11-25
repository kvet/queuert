import type { LessonRun } from "../lesson.ts";

export const check = ({ logs }: LessonRun): void => {
  if (!logs.includes("Paging on-call for t-1")) {
    throw new Error("Continue an urgent ticket with page-on-call.");
  }
  if (!logs.includes("Queued t-2 for support")) {
    throw new Error("Continue a ticket that is not urgent with queue-for-support.");
  }
  if (!logs.some((line) => line.startsWith("t-1 handled by") && line.includes("on-call"))) {
    throw new Error("The urgent ticket's chain should end with the output of page-on-call.");
  }
};
