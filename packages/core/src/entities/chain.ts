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
  { chainIds, typeNames }: { chainIds: string[]; typeNames: (string | undefined)[] },
): void => {
  const mismatched = chainIds.flatMap((chainId, index) => {
    const stateChain = stateChains[index];
    const typeName = typeNames[index];
    return typeName && stateChain !== undefined && stateChain.typeName !== typeName
      ? [{ chainId, expectedTypeName: typeName, actualTypeName: stateChain.typeName }]
      : [];
  });
  if (mismatched.length === 0) return;
  throw new ChainsTypeMismatchError(
    `Chains have a different type than expected: ${mismatched
      .map(
        ({ chainId, expectedTypeName, actualTypeName }) =>
          `${chainId} (expected "${expectedTypeName}", found "${actualTypeName}")`,
      )
      .join(", ")}`,
    {
      chainIds: mismatched.map(({ chainId }) => chainId),
      expectedTypeNames: mismatched.map(({ expectedTypeName }) => expectedTypeName),
      actualTypeNames: mismatched.map(({ actualTypeName }) => actualTypeName),
    },
  );
};
