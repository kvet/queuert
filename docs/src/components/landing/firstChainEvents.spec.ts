import "../integrations/dashboard/demo/dispose-symbols.ts";
import { readFileSync } from "node:fs";

import * as queuert from "queuert";
import typescript from "typescript";
import { describe, expect, it } from "vitest";

import {
  type ChainEvent,
  createChainRecorder,
  groupFrames,
  reduceChains,
} from "../tutorial/recorder.ts";
import { compileExercise, executeExercise } from "../tutorial/runtime.ts";
import { firstChainEvents } from "./firstChainEvents.ts";

const heroSource = readFileSync(
  new URL("../../../../examples/tutorial/src/hero.ts", import.meta.url),
  "utf8",
);

const withoutIdsAndTimes = (events: ChainEvent[]) => {
  const ids = new Map<string, string>();
  const idOf = (id: string) => {
    if (!ids.has(id)) ids.set(id, `id-${ids.size}`);
    return ids.get(id)!;
  };
  return JSON.parse(
    JSON.stringify(events, (key, value: unknown) => {
      if (typeof value !== "string") return value;
      if (key === "chainId" || key === "jobId" || key === "continuedWith") return idOf(value);
      return value.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<time>");
    }),
  ) as unknown;
};

describe("firstChainEvents", () => {
  it("plays as three frames that end in one completed chain", () => {
    expect(groupFrames(firstChainEvents)).toHaveLength(3);
    const [chain] = reduceChains(firstChainEvents);
    expect(reduceChains(firstChainEvents)).toHaveLength(1);
    expect(chain.status).toBe("completed");
    expect(chain.jobs.map((job) => job.status)).toEqual(["completed"]);
  });

  it("matches the events the hero's code records when it runs", async () => {
    const recorded: ChainEvent[] = [];
    const result = await executeExercise({
      compiled: compileExercise(
        typescript,
        { "index.ts": heroSource },
        "export const check = () => {};",
      ),
      modules: { queuert: createChainRecorder(queuert, (event) => recorded.push(event)) },
    });

    expect(result).toEqual({ status: "passed" });
    expect(withoutIdsAndTimes(firstChainEvents)).toEqual(withoutIdsAndTimes(recorded));
  });
});
