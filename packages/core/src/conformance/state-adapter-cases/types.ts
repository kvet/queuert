import { type StateAdapter } from "../../state-adapter/state-adapter.js";

export type StateAdapterConformanceContext = {
  stateAdapter: StateAdapter<any, any>;
  poisonTransaction?: (txCtx: any) => Promise<void>;
};
