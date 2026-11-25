import type { LessonRun } from "../lesson.ts";

export const check = ({ logs }: LessonRun): void => {
  if (!logs.includes("Sending a welcome email to ada@example.com")) {
    throw new Error(
      "No chain was committed. Sign up with a valid email so the transaction commits instead of rolling back.",
    );
  }
  if (!logs.includes("Users saved: 1")) {
    throw new Error("The user should be saved together with the chain.");
  }
};
