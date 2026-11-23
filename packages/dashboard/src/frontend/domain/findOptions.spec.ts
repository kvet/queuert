import { describe, expect, it } from "vitest";

import type { WorkerWithRunningJobs } from "../../shared/types.ts";
import { findOptions } from "./findOptions.ts";
import { pendingJob, runningChain } from "./fixtures.spec-helper.ts";

const worker = { id: "worker/eu 1", runningJobCount: 0 } as WorkerWithRunningJobs;

describe("findOptions", () => {
  it("links each found chain, job and worker to its page", () => {
    expect(
      findOptions(
        [
          { kind: "chain", chain: runningChain("abc") },
          { kind: "job", job: pendingJob({ id: "abc" }) },
          { kind: "worker", worker },
        ],
        [],
      ).map((option) => option.href),
    ).toEqual(["/chains/abc", "/jobs/abc", "/workers/worker%2Feu%201"]);
  });

  it("links each type suggestion to its filtered list", () => {
    expect(
      findOptions(
        [],
        [
          { kind: "chain", typeName: "order:validate" },
          { kind: "job", typeName: "order:validate" },
        ],
      ).map((option) => option.href),
    ).toEqual(["/chains?typeName=order%3Avalidate", "/jobs?typeName=order%3Avalidate"]);
  });

  it("offers the found items instead of type suggestions once a lookup found several", () => {
    const options = findOptions(
      [{ kind: "chain", chain: runningChain("abc") }],
      [{ kind: "chain", typeName: "abc-flow" }],
    );
    expect(options).toHaveLength(1);
    expect("choice" in options[0]).toBe(true);
  });
});
