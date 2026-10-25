import { describe, expect, it, vi } from "vitest";

import { type ResolvedJobTypeValue, createNoopJobTypes } from "../job-types/job-types.js";
import { type StateChainInfo, type StateJobInfo } from "../state-adapter/state-adapter.js";
import { mapStateChainsToChains } from "./chain.js";

const headJob: StateJobInfo = {
  id: "chain-1",
  chainId: "chain-1",
  typeName: "test",
  chainIndex: 0,
  input: { value: 1 },
  output: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  scheduledAt: new Date("2026-01-01T00:00:00Z"),
  attempt: 1,
  lastAttemptAt: null,
  lastAttemptError: null,
  attemptAt: null,
  attemptBy: null,
  attemptUntil: null,
  completedAt: new Date("2026-01-01T00:01:00Z"),
  completedBy: "worker-1",
  continuedToId: "job-2",
  status: "completed",
  traceContext: null,
};

const chainInfo: StateChainInfo = {
  id: "chain-1",
  typeName: "test",
  status: "running",
  deduplicationKey: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  completedAt: null,
  traceContext: null,
};

const mapOne = async (stateChain: Parameters<typeof mapStateChainsToChains>[0][number]) =>
  (await mapStateChainsToChains([stateChain], createNoopJobTypes()))[0];

describe("mapStateChainsToChains", () => {
  it("does not fabricate an output for a chain whose head has continued", async () => {
    const chain = await mapOne({ ...chainInfo, head: headJob, tail: undefined });

    expect(chain.status).toBe("running");
    expect("output" in chain).toBe(false);
    expect("completedAt" in chain).toBe(false);
  });

  it("reads the chain's completion from the chain, and its output from the tail", async () => {
    const tail: StateJobInfo = {
      ...headJob,
      id: "job-2",
      continuedToId: null,
      output: { value: 2 },
      completedAt: new Date("2026-01-01T00:02:00Z"),
    };

    const chain = await mapOne({
      ...chainInfo,
      status: "completed",
      completedAt: new Date("2026-01-01T00:02:00Z"),
      head: headJob,
      tail,
    });

    expect(chain).toMatchObject({
      status: "completed",
      output: { value: 2 },
      completedAt: new Date("2026-01-01T00:02:00Z"),
      input: { value: 1 },
    });
  });

  it("reads a single-job chain's output from its head", async () => {
    const soleJob: StateJobInfo = { ...headJob, continuedToId: null, output: { value: 9 } };

    const chain = await mapOne({
      ...chainInfo,
      status: "completed",
      completedAt: new Date("2026-01-01T00:01:00Z"),
      head: soleJob,
      tail: undefined,
    });

    expect(chain).toMatchObject({ status: "completed", output: { value: 9 } });
  });

  it("decodes a page in one call, the head input under the head type and the output under the tail type", async () => {
    const decode = vi.fn(async (items: readonly ResolvedJobTypeValue[]) =>
      items.map((item) => ({ decoded: item.value })),
    );
    const tail: StateJobInfo = {
      ...headJob,
      id: "job-2",
      typeName: "test-tail",
      continuedToId: null,
      output: { value: 2 },
    };

    const [running, completed] = await mapStateChainsToChains(
      [
        { ...chainInfo, head: headJob, tail: undefined },
        { ...chainInfo, status: "completed", completedAt: tail.completedAt, head: headJob, tail },
      ],
      { decode },
    );

    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0][0]).toEqual([
      { typeName: "test", direction: "input", value: { value: 1 } },
      { typeName: "test", direction: "input", value: { value: 1 } },
      { typeName: "test-tail", direction: "output", value: { value: 2 } },
    ]);
    expect(running.input).toEqual({ decoded: { value: 1 } });
    expect(completed).toMatchObject({ output: { decoded: { value: 2 } } });
  });
});
