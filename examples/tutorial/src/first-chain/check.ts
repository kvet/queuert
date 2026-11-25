import type { LessonRun } from "../lesson.ts";

export const check = ({ logs }: LessonRun): void => {
  if (!logs.includes("Sending a welcome email to ada")) {
    throw new Error('Create a send-welcome-email chain with userId "ada".');
  }
  if (!logs.some((line) => line.startsWith("Chain completed with"))) {
    throw new Error("Wait for the chain with client.awaitChain, then log its output.");
  }
};
