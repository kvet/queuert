import { type StateJob } from "../state-adapter/state-adapter.js";
import { type Chain, type ChainStatus } from "./chain.types.js";

export type * from "./chain.types.js";

/**
 * Derives a chain's status from its tail job. A chain is `closed` iff its tail
 * is terminally completed; otherwise `open`. The tail never has a successor, so
 * a `succeeded` tail is impossible by construction.
 */
export const deriveChainStatus = (tailJob: StateJob): ChainStatus =>
  tailJob.completedAt !== null ? "closed" : "open";

/**
 * Translates a set of requested chain statuses into the `closed` list filter.
 * Returns `undefined` (no filter) when both or neither status is requested.
 */
export const chainStatusesToClosedFilter = (
  statuses: ChainStatus[] | undefined,
): boolean | undefined => {
  if (!statuses || statuses.length === 0) return undefined;
  const wantsOpen = statuses.includes("open");
  const wantsClosed = statuses.includes("closed");
  if (wantsOpen === wantsClosed) return undefined;
  return wantsClosed;
};

export const mapStatePairToChain = (
  stateJobPair: [StateJob, StateJob | undefined],
): Chain<any, any, any, any> => {
  const [initialJob, currentJob] = stateJobPair;
  const effectiveJob = currentJob ?? initialJob;

  const base = {
    id: initialJob.id,
    typeName: initialJob.chainTypeName,
    input: initialJob.input,
    createdAt: initialJob.createdAt,
  };

  switch (deriveChainStatus(effectiveJob)) {
    case "closed":
      return {
        ...base,
        status: "closed",
        output: effectiveJob.output,
        completedAt: effectiveJob.completedAt!,
      };
    case "open":
      return { ...base, status: "open" };
  }
};
