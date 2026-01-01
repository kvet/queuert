import { type TestAPI } from "vitest";
import { createInProcessStateAdapter, InProcessStateAdapter } from "./state-adapter.in-process.js";

export const extendWithStateInProcess = <T>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    stateAdapter: InProcessStateAdapter;
  }
> => {
  return api.extend<{
    stateAdapter: InProcessStateAdapter;
  }>({
    stateAdapter: [
      async ({}, use) => {
        await use(createInProcessStateAdapter());
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateInProcess<T>>;
};
