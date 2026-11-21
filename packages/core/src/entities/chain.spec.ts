import { describe, expect, it, vi } from "vitest";

import { ChainsTypeMismatchError } from "../errors.ts";
import { createNoopJobTypes } from "../job-types/job-types.ts";
import type { StateChain, StateChainInfo, StateJobInfo } from "../state-adapter/state-adapter.ts";
import { assertChainsTypeName, mapStateChainToChain } from "./chain.ts";

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
  consecutiveFailures: 0,
  lastAttemptAt: null,
  lastAttemptError: null,
  lastRescheduleReason: null,
  attemptAt: null,
  attemptBy: null,
  attemptToken: null,
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
  blocking: false,
};

const mapOne = (stateChain: Parameters<typeof mapStateChainToChain>[0]) =>
  mapStateChainToChain(stateChain, createNoopJobTypes());

describe("mapStateChainToChain", () => {
  it("does not fabricate an output for a chain whose head has continued", () => {
    const chain = mapOne({ ...chainInfo, head: headJob, tail: undefined });

    expect(chain.status).toBe("running");
    expect("output" in chain).toBe(false);
    expect("completedAt" in chain).toBe(false);
  });

  it("reads the chain's completion from the chain, and its output from the tail", () => {
    const tail: StateJobInfo = {
      ...headJob,
      id: "job-2",
      continuedToId: null,
      output: { value: 2 },
      completedAt: new Date("2026-01-01T00:02:00Z"),
    };

    const chain = mapOne({
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

  it("reads a single-job chain's output from its head", () => {
    const soleJob: StateJobInfo = { ...headJob, continuedToId: null, output: { value: 9 } };

    const chain = mapOne({
      ...chainInfo,
      status: "completed",
      completedAt: new Date("2026-01-01T00:01:00Z"),
      head: soleJob,
      tail: undefined,
    });

    expect(chain).toMatchObject({ status: "completed", output: { value: 9 } });
  });

  it("decodes the head input under the head type and the output under the tail type", () => {
    const decodeInput = vi.fn((_typeName: string, input: unknown) => ({ decoded: input }));
    const decodeOutput = vi.fn((_typeName: string, output: unknown) => ({ decoded: output }));
    const tail: StateJobInfo = {
      ...headJob,
      id: "job-2",
      typeName: "test-tail",
      continuedToId: null,
      output: { value: 2 },
    };

    const chain = mapStateChainToChain(
      { ...chainInfo, status: "completed", completedAt: tail.completedAt, head: headJob, tail },
      { decodeInput, decodeOutput },
    );

    expect(decodeInput).toHaveBeenCalledExactlyOnceWith("test", { value: 1 });
    expect(decodeOutput).toHaveBeenCalledExactlyOnceWith("test-tail", { value: 2 });
    expect(chain).toMatchObject({
      input: { decoded: { value: 1 } },
      output: { decoded: { value: 2 } },
    });
  });
});

const stateChain: StateChain = { ...chainInfo, head: headJob, tail: undefined };

describe("assertChainsTypeName", () => {
  it("passes without a type name, a stored chain, or a mismatch", () => {
    expect(() => {
      assertChainsTypeName([{ ...stateChain, typeName: "other" }], {
        chainIds: ["chain-1"],
        typeName: undefined,
      });
    }).not.toThrow();
    expect(() => {
      assertChainsTypeName([undefined, stateChain], {
        chainIds: ["chain-1", "chain-2"],
        typeName: "test",
      });
    }).not.toThrow();
  });

  it("throws ChainsTypeMismatchError listing every chain whose stored type differs", () => {
    expect(() => {
      assertChainsTypeName(
        [
          { ...stateChain, id: "chain-1", typeName: "other" },
          { ...stateChain, id: "chain-2" },
          { ...stateChain, id: "chain-3", typeName: "another" },
        ],
        { chainIds: ["chain-1", "chain-2", "chain-3"], typeName: "test" },
      );
    }).toThrow(
      expect.objectContaining({
        constructor: ChainsTypeMismatchError,
        chainIds: ["chain-1", "chain-3"],
        expectedTypeNames: ["test", "test"],
        actualTypeNames: ["other", "another"],
      }),
    );
  });
});
