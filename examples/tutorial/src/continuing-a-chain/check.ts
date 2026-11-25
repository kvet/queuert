import type { LessonRun } from "../lesson.ts";

export const check = ({ logs }: LessonRun): void => {
  if (!logs.includes("Sending a welcome email to acc-ada")) {
    throw new Error(
      "Continue provision-account with send-welcome-email instead of completing the chain.",
    );
  }
  if (!logs.some((line) => line.startsWith("Chain completed with") && line.includes("sentAt"))) {
    throw new Error("The chain's output should come from send-welcome-email, its last job.");
  }
};
