import type { LessonRun } from "../lesson.ts";

export const check = ({ logs }: LessonRun): void => {
  if (!logs.includes("Sending a welcome email to ada")) {
    throw new Error("ada signed up, so ada should get a welcome email.");
  }
  if (logs.includes("Sending a welcome email to ada-again")) {
    throw new Error(
      "ada-again was never saved but still got a welcome email. Insert the user and create the chain in one transaction.",
    );
  }
};
