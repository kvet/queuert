import { describe, expect, test, vi } from "vitest";

import { HookRegistry } from "./hook-registry.ts";

describe("HookRegistry", () => {
  test("discard does not leave a rejected promise from a rollback callback unhandled", async () => {
    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      const registry = new HookRegistry<() => void>();
      // oxlint-disable-next-line typescript/no-misused-promises -- asserts that a misused async rollback callback is silenced
      registry.onRollback(async () => {
        throw new Error("async rollback callback failed");
      });

      registry.discard();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
