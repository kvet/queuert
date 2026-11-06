import { type StateAdapter } from "../../state-adapter/state-adapter.js";
import { SkipSignalError } from "../skip-signal-error.js";
import { type StateConformanceFixture } from "./types.js";

type IsolationPair = {
  name: string;
  first: StateAdapter<any, any, any>;
  second: StateAdapter<any, any, any>;
};

const listIsolationPairs = ({
  stateAdapter,
  isolationVariants,
}: StateConformanceFixture): IsolationPair[] => {
  const variants = isolationVariants ?? [{ name: "default", stateAdapter }];
  return variants.flatMap((first) =>
    variants.map((second) => ({
      name: `${first.name} → ${second.name}`,
      first: first.stateAdapter,
      second: second.stateAdapter,
    })),
  );
};

export const forEachIsolationPair = async (
  fixture: StateConformanceFixture,
  run: (pair: IsolationPair) => Promise<void>,
): Promise<void> => {
  for (const pair of listIsolationPairs(fixture)) {
    try {
      await run(pair);
    } catch (error) {
      if (error instanceof SkipSignalError) throw error;
      throw new Error(
        `isolation pair ${pair.name}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
};
