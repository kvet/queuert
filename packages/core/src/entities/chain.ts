import { ChainsTypeMismatchError } from "../errors.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import type { StateChain, StateChainInfo } from "../state-adapter/state-adapter.ts";
import type { AnyChain } from "./chain.types.ts";

export type * from "./chain.types.ts";

export const mapStateChainToChain = (
  stateChain: StateChain,
  jobTypes: Pick<JobTypes<any>, "decodeInput" | "decodeOutput">,
): AnyChain => {
  const base = {
    id: stateChain.id,
    typeName: stateChain.typeName,
    input: jobTypes.decodeInput(stateChain.head.typeName, stateChain.head.input),
    createdAt: stateChain.createdAt,
  };

  if (stateChain.status === "running") return { ...base, status: "running" };

  const tail = stateChain.tail ?? stateChain.head;
  return {
    ...base,
    status: "completed",
    output: jobTypes.decodeOutput(tail.typeName, tail.output),
    completedAt: stateChain.completedAt!,
  };
};

export const assertChainsTypeName = (
  stateChains: (StateChainInfo | undefined)[],
  { chainIds, typeName }: { chainIds: string[]; typeName: string | undefined },
): void => {
  if (!typeName) return;
  const mismatched = chainIds.flatMap((chainId, index) => {
    const stateChain = stateChains[index];
    return stateChain !== undefined && stateChain.typeName !== typeName
      ? [{ chainId, actualTypeName: stateChain.typeName }]
      : [];
  });
  if (mismatched.length === 0) return;
  throw new ChainsTypeMismatchError(
    `Expected chains to have type "${typeName}": ${mismatched
      .map(({ chainId, actualTypeName }) => `${chainId} (found "${actualTypeName}")`)
      .join(", ")}`,
    {
      chainIds: mismatched.map(({ chainId }) => chainId),
      expectedTypeNames: mismatched.map(() => typeName),
      actualTypeNames: mismatched.map(({ actualTypeName }) => actualTypeName),
    },
  );
};
