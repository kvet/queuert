import { ChainTypeMismatchError } from "../errors.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import type { StateChain } from "../state-adapter/state-adapter.ts";
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

export const assertChainTypeName = (
  stateChain: StateChain | undefined,
  { chainId, typeName }: { chainId: string; typeName: string | undefined },
): void => {
  if (!typeName || stateChain === undefined || stateChain.typeName === typeName) return;
  throw new ChainTypeMismatchError(
    `Expected chain ${chainId} to have type "${typeName}" but found "${stateChain.typeName}"`,
    {
      expectedTypeName: typeName,
      actualTypeName: stateChain.typeName,
    },
  );
};
