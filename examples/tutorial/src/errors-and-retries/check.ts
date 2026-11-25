import type { LessonRun } from "../lesson.ts";

export const check = ({ logs }: LessonRun): void => {
  if (!logs.some((line) => line.startsWith("Chain completed with"))) {
    throw new Error(
      "The chain did not finish in time. Give sync-to-crm a backoffConfig with a short initialDelayMs so its retries come quickly.",
    );
  }
  if (logs.filter((line) => line.startsWith("Syncing ada to the CRM")).length < 3) {
    throw new Error("sync-to-crm should fail twice and succeed on its third attempt.");
  }
};
