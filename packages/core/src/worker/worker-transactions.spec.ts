import { describe, expect, test } from "vitest";

import type { NotifyHelper } from "../notify-adapter/notify-helper.ts";
import { notifyReclaimed } from "./worker-transactions.ts";

describe("notifyReclaimed", () => {
  test("starts the scheduled notification before the attempt-lost one finishes", async () => {
    const started: string[] = [];
    const attemptsLost = Promise.withResolvers<void>();
    const notifyHelper = {
      notifyJobAttemptsLost: async (jobIds: string[]) => {
        started.push(`lost ${jobIds.join(",")}`);
        await attemptsLost.promise;
      },
      notifyJobsScheduled: async (typeNames: string[]) => {
        started.push(`scheduled ${typeNames.join(",")}`);
      },
    } as Partial<NotifyHelper> as NotifyHelper;

    const notified = notifyReclaimed(notifyHelper, {
      jobIds: ["job-1"],
      typeNames: ["send-welcome-email"],
    });

    expect(started).toEqual(["lost job-1", "scheduled send-welcome-email"]);
    attemptsLost.resolve();
    await notified;
  });
});
