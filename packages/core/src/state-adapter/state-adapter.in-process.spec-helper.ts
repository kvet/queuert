import { type TestAPI } from "vitest";
import {
  type InProcessStateAdapter,
  createInProcessStateAdapter,
} from "./state-adapter.in-process.js";
import { type StateAdapter } from "./state-adapter.js";

export const extendWithStateInProcess = <T>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    stateAdapter: StateAdapter<{ $test: true }, string>;
  }
> => {
  return api.extend<{
    stateAdapter: InProcessStateAdapter;
  }>({
    stateAdapter: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(createInProcessStateAdapter());
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateInProcess<T>>;
};
