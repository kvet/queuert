import { describe, expect, it } from "vitest";

import { learnSteps } from "../../data/learn.ts";
import { stepperItems } from "./stepper.ts";

describe("stepperItems", () => {
  it("numbers the steps from one and links each to its page", () => {
    const items = stepperItems(learnSteps, "job-blockers", () => false);

    expect(items.map((item) => item.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(items[0]?.slug).toBe("learn/first-chain");
    expect(items[5]?.slug).toBe("learn/job-blockers");
  });

  it("marks exactly the open step as current", () => {
    const items = stepperItems(learnSteps, "continuing-a-chain", () => false);

    expect(items.filter((item) => item.current).map((item) => item.id)).toEqual([
      "continuing-a-chain",
    ]);
  });

  it("marks done steps from the progress lookup, independent of the current step", () => {
    const done = new Set(["first-chain", "transactional-completion"]);
    const items = stepperItems(learnSteps, "transactional-completion", (id) => done.has(id));

    expect(items.map((item) => item.done)).toEqual([true, false, false, true, false, false]);
  });
});
