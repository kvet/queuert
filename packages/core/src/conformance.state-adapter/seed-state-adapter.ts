import {
  type InProcessStateAdapter,
  createInProcessStateAdapterWithState,
} from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { StateDump } from "../state-adapter/state-dump.ts";

export const createSeedStateAdapter = ({
  now,
  generateJobId,
}: {
  now?: () => number;
  generateJobId?: () => string;
} = {}): {
  stateAdapter: InProcessStateAdapter;
  dumpState: () => StateDump;
  loadState: (dump: StateDump, options: { offsetMs: number }) => void;
} => {
  const { stateAdapter, dumpState, loadState } = createInProcessStateAdapterWithState(
    { mode: "sync", ...(generateJobId === undefined ? {} : { generateJobId }) },
    now === undefined ? {} : { now },
  );
  return { stateAdapter: stateAdapter as InProcessStateAdapter, dumpState, loadState };
};
