import { type JobTypes, type ResolvedJobTypeValue } from "../job-types/job-types.js";
import { type StateChain } from "../state-adapter/state-adapter.js";
import { type AnyChain } from "./chain.types.js";

export type * from "./chain.types.js";

export const mapStateChainsToChains = async (
  stateChains: readonly StateChain[],
  jobTypes: Pick<JobTypes<any>, "decode">,
): Promise<AnyChain[]> => {
  if (stateChains.length === 0) return [];

  const items: ResolvedJobTypeValue[] = [];
  for (const stateChain of stateChains) {
    items.push({
      typeName: stateChain.head.typeName,
      direction: "input",
      value: stateChain.head.input,
    });
    if (stateChain.status === "completed") {
      const tail = stateChain.tail ?? stateChain.head;
      items.push({ typeName: tail.typeName, direction: "output", value: tail.output });
    }
  }

  const decoded = await jobTypes.decode(items);

  let cursor = 0;
  return stateChains.map((stateChain) => {
    const base = {
      id: stateChain.id,
      typeName: stateChain.typeName,
      input: decoded[cursor++],
      createdAt: stateChain.createdAt,
    };

    if (stateChain.status === "running") return { ...base, status: "running" };

    return {
      ...base,
      status: "completed",
      output: decoded[cursor++],
      completedAt: stateChain.completedAt!,
    };
  });
};
