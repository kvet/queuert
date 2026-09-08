import { type StateChain } from "../state-adapter/state-adapter.js";
import { type AnyChain } from "./chain.types.js";

export type * from "./chain.types.js";

export const mapStateChainToChain = (stateChain: StateChain): AnyChain => {
  const base = {
    id: stateChain.id,
    typeName: stateChain.typeName,
    input: stateChain.head.input,
    createdAt: stateChain.createdAt,
  };

  if (stateChain.completedAt === null) return { ...base, status: "running" };

  return {
    ...base,
    status: "completed",
    output: (stateChain.tail ?? stateChain.head).output,
    completedAt: stateChain.completedAt,
  };
};
