import { type TestAPI, describe } from "vitest";

import { expect as defaultExpect } from "../conformance/expect.ts";
import {
  type NotifyConformanceFixture,
  notifyAdapterConformanceGroups,
} from "../conformance/notify-adapter-cases.ts";
import { SkipSignalError } from "../conformance/runner.ts";

export { type NotifyConformanceFixture } from "../conformance/notify-adapter-cases.ts";

/**
 * Run the notify adapter conformance cases inside a vitest suite.
 *
 * Shares cases with {@link runNotifyAdapterConformance} (queuert/conformance).
 * The vitest suite surfaces per-case pass/fail to vitest's reporter while the
 * runner gives end users an embeddable single-test form.
 */
export const notifyAdapterConformanceTestSuite = <T extends NotifyConformanceFixture>({
  it,
}: {
  it: TestAPI<T>;
}): void => {
  for (const group of notifyAdapterConformanceGroups) {
    describe(group.name, () => {
      for (const testCase of group.cases) {
        it(testCase.name, async ({ notifyAdapter, skip }) => {
          try {
            await testCase.run({ notifyAdapter }, defaultExpect);
          } catch (err) {
            if (err instanceof SkipSignalError) {
              (skip as unknown as ((note?: string) => void) | undefined)?.(err.reason);
              return;
            }
            throw err;
          }
        });
      }
    });
  }
};
