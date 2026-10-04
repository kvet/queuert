import { describe, expect, it } from "vitest";

import { createHistoryTracker } from "./navigation.js";

const createHistory = (startDepth: number) => {
  let depth = startDepth;
  const tracker = createHistoryTracker(() => depth);
  return {
    tracker,
    push: (location: string) => {
      depth += 1;
      tracker.recordLocation(location);
    },
    replace: (location: string) => {
      tracker.recordLocation(location);
    },
    back: (location: string) => {
      depth -= 1;
      tracker.recordLocation(location);
    },
  };
};

describe("createHistoryTracker", () => {
  it("does not go back from the entry the app was opened on", () => {
    const { tracker, replace } = createHistory(3);
    replace("/jobs/a");

    expect(tracker.canGoBack()).toBe(false);
    expect(tracker.previousLocation()).toBeNull();
  });

  it("goes back to the previous in-app location after a push", () => {
    const { tracker, replace, push } = createHistory(3);
    replace("/jobs?typeName=greet");
    push("/jobs/a");

    expect(tracker.canGoBack()).toBe(true);
    expect(tracker.previousLocation()).toBe("/jobs?typeName=greet");
  });

  it("stops going back once browser back returns to the entry page", () => {
    const { tracker, replace, push, back } = createHistory(0);
    replace("/jobs/a");
    push("/jobs/b");
    back("/jobs/a");

    expect(tracker.canGoBack()).toBe(false);
    expect(tracker.previousLocation()).toBeNull();
  });

  it("keeps the depth on a replace and records the replaced location", () => {
    const { tracker, replace, push } = createHistory(0);
    replace("/find");
    push("/chains?typeName=greet");
    replace("/chains?typeName=greet&status=running");
    push("/chains/c");

    expect(tracker.previousLocation()).toBe("/chains?typeName=greet&status=running");
  });
});
