import { describe, expect, it } from "vitest";

import {
  chainJobs,
  chainPhases,
  chainStatusAt,
  lastChainPhase,
  logWindowAt,
} from "./liveChainScenario.ts";

describe("liveChainScenario", () => {
  it("never shows more jobs than the chain has, and adds at most one per phase", () => {
    let previous = 0;
    for (const phase of chainPhases) {
      expect(phase.statuses.length).toBeLessThanOrEqual(chainJobs.length);
      expect(phase.statuses.length - previous).toBeLessThanOrEqual(1);
      previous = phase.statuses.length;
    }
  });

  it("keeps earlier jobs completed while a later one runs", () => {
    for (const phase of chainPhases) {
      for (const status of phase.statuses.slice(0, -1)) {
        expect(status).toBe("completed");
      }
    }
  });

  it("runs the chain until its tail job completes", () => {
    for (let step = 0; step < lastChainPhase; step++) {
      expect(chainStatusAt(step)).toBe("running");
    }
    expect(chainStatusAt(lastChainPhase)).toBe("completed");
  });

  it("pads the log window to a fixed size", () => {
    expect(logWindowAt(0, 3)).toEqual([chainPhases[0].log, undefined, undefined]);
    expect(logWindowAt(lastChainPhase, 3)).toEqual(chainPhases.slice(-3).map((phase) => phase.log));
  });
});
