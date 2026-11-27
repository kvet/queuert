import type { LessonRun } from "../lesson.ts";

export const check = ({ logs }: LessonRun): void => {
  if (logs.filter((line) => line.startsWith("Reserving 2 × lamp")).length < 2) {
    throw new Error("Keep the crash on the first attempt: the lesson is about surviving it.");
  }
  if (!logs.includes("Lamps in stock: 8")) {
    throw new Error(
      "The crashed attempt's reservation was kept, so the order took stock twice. Run the UPDATE in the transaction that completes the job.",
    );
  }
};
