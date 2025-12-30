import { type TestAPI } from "vitest";
import { createInProcessStateAdapter, InProcessStateAdapter } from "./state-adapter.in-process.js";

export const extendWithStateInProcess = <T>(
  api: TestAPI<T>,
): TestAPI<
  T & {
    stateAdapter: InProcessStateAdapter;
    flakyStateAdapter: InProcessStateAdapter;
  }
> => {
  return api.extend<{
    stateAdapter: InProcessStateAdapter;
    flakyStateAdapter: InProcessStateAdapter;
  }>({
    stateAdapter: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const adapter = createInProcessStateAdapter();

        // Initialize (no-ops for in-process)
        await adapter.provideContext(async (context) => {
          await adapter.prepareSchema(context);
          await adapter.migrateToLatest(context);
        });

        await use(adapter);
      },
      { scope: "test" },
    ],
    // In-process has no network flakiness, so flakyStateAdapter is the same as stateAdapter
    flakyStateAdapter: [
      async ({ stateAdapter }, use) => {
        await use(stateAdapter);
      },
      { scope: "test" },
    ],
  }) as ReturnType<typeof extendWithStateInProcess<T>>;
};
