import type { StateChain } from "../state-adapter/state-adapter.ts";
import type { AnyChain } from "./chain.types.ts";

export type * from "./chain.types.ts";

export const mapStateChainToChain = (stateChain: StateChain): AnyChain => {
  const base = {
    id: stateChain.id,
    typeName: stateChain.typeName,
    input: stateChain.head.input,
    createdAt: stateChain.createdAt,
  };

  if (stateChain.status === "running") return { ...base, status: "running" };

  return {
    ...base,
    status: "completed",
    output: (stateChain.tail ?? stateChain.head).output,
    completedAt: stateChain.completedAt!,
  };
};
