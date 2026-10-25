import { type Operation } from "@queuert/helpers";

import { type StateAdapter } from "./state-adapter.js";

type StateDataMethodName = Exclude<
  keyof StateAdapter<any, any>,
  "config" | "mode" | "withTransaction" | "isTransaction" | "close"
>;

export type StateOperations = {
  [K in StateDataMethodName]: (
    params: Parameters<StateAdapter<any, any>[K]>[0],
  ) => Operation<Awaited<ReturnType<StateAdapter<any, any>[K]>>>;
};

export const createStateOperations = (stateAdapter: StateAdapter<any, any, any>): StateOperations =>
  Object.fromEntries(
    Object.entries(stateAdapter)
      .filter(([, method]) => typeof method === "function")
      .map(([name, method]: [string, (params: unknown) => unknown]) => [
        name,
        function* (params: unknown): Operation<unknown> {
          return yield method(params);
        },
      ]),
  ) as StateOperations;
