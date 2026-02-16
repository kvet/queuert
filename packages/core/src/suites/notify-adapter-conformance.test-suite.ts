import { type TestAPI, describe } from "vitest";
import { sleep } from "../helpers/sleep.js";
import { type NotifyAdapter } from "../notify-adapter/notify-adapter.js";

export type NotifyAdapterConformanceContext = {
  notifyAdapter: NotifyAdapter;
};

const NEGATIVE_ASSERTION_DELAY_MS = 200;

export const notifyAdapterConformanceTestSuite = <T extends NotifyAdapterConformanceContext>({
  it,
}: {
  it: TestAPI<T>;
}): void => {
  describe("notifyJobScheduled / listenJobScheduled", () => {
    it("listener receives notification for matching type name", async ({
      notifyAdapter,
      expect,
    }) => {
      const received = Promise.withResolvers<string>();
      const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], (typeName) => {
        received.resolve(typeName);
      });

      await notifyAdapter.notifyJobScheduled("type-a", 1);

      const result = await Promise.race([
        received.promise,
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notification");
        }),
      ]);

      expect(result).toBe("type-a");
      await unsubscribe();
    });

    it("listener receives notification when count > 1", async ({ notifyAdapter, expect }) => {
      const received = Promise.withResolvers<string>();
      const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], (typeName) => {
        received.resolve(typeName);
      });

      await notifyAdapter.notifyJobScheduled("type-a", 5);

      const result = await Promise.race([
        received.promise,
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notification");
        }),
      ]);

      expect(result).toBe("type-a");
      await unsubscribe();
    });

    it("listener does not receive notification for non-matching type name", async ({
      notifyAdapter,
      expect,
    }) => {
      let callCount = 0;
      const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], () => {
        callCount++;
      });

      await notifyAdapter.notifyJobScheduled("type-b", 1);
      await sleep(NEGATIVE_ASSERTION_DELAY_MS);

      expect(callCount).toBe(0);
      await unsubscribe();
    });

    it("multi-type listener receives matching types", async ({ notifyAdapter, expect }) => {
      const received = Promise.withResolvers<string>();
      const unsubscribe = await notifyAdapter.listenJobScheduled(
        ["type-a", "type-b"],
        (typeName) => {
          received.resolve(typeName);
        },
      );

      await notifyAdapter.notifyJobScheduled("type-b", 1);

      const result = await Promise.race([
        received.promise,
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notification");
        }),
      ]);

      expect(result).toBe("type-b");
      await unsubscribe();
    });

    it("unsubscribe stops job scheduled notifications", async ({ notifyAdapter, expect }) => {
      let callCount = 0;
      const unsubscribe = await notifyAdapter.listenJobScheduled(["type-a"], () => {
        callCount++;
      });

      await unsubscribe();
      await notifyAdapter.notifyJobScheduled("type-a", 1);
      await sleep(NEGATIVE_ASSERTION_DELAY_MS);

      expect(callCount).toBe(0);
    });

    it("publish without listeners does not error", async ({ notifyAdapter }) => {
      await notifyAdapter.notifyJobScheduled("type-a", 1);
      await notifyAdapter.notifyJobChainCompleted("chain-1");
      await notifyAdapter.notifyJobOwnershipLost("job-1");
    });
  });

  describe("notifyJobChainCompleted / listenJobChainCompleted", () => {
    it("listener receives chain completion for matching chain ID", async ({ notifyAdapter }) => {
      const received = Promise.withResolvers<void>();
      const unsubscribe = await notifyAdapter.listenJobChainCompleted("chain-123", () => {
        received.resolve();
      });

      await notifyAdapter.notifyJobChainCompleted("chain-123");

      await Promise.race([
        received.promise,
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notification");
        }),
      ]);

      await unsubscribe();
    });

    it("listener does not receive chain completion for different chain ID", async ({
      notifyAdapter,
      expect,
    }) => {
      let callCount = 0;
      const unsubscribe = await notifyAdapter.listenJobChainCompleted("chain-123", () => {
        callCount++;
      });

      await notifyAdapter.notifyJobChainCompleted("chain-456");
      await sleep(NEGATIVE_ASSERTION_DELAY_MS);

      expect(callCount).toBe(0);
      await unsubscribe();
    });

    it("multiple listeners for same chain ID both receive notification", async ({
      notifyAdapter,
    }) => {
      const received1 = Promise.withResolvers<void>();
      const received2 = Promise.withResolvers<void>();

      const unsubscribe1 = await notifyAdapter.listenJobChainCompleted("chain-multi", () => {
        received1.resolve();
      });
      const unsubscribe2 = await notifyAdapter.listenJobChainCompleted("chain-multi", () => {
        received2.resolve();
      });

      await notifyAdapter.notifyJobChainCompleted("chain-multi");

      await Promise.race([
        Promise.all([received1.promise, received2.promise]),
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notifications");
        }),
      ]);

      await unsubscribe1();
      await unsubscribe2();
    });

    it("unsubscribe stops chain completion notifications", async ({ notifyAdapter, expect }) => {
      let callCount = 0;
      const unsubscribe = await notifyAdapter.listenJobChainCompleted("chain-unsubscribe", () => {
        callCount++;
      });

      await unsubscribe();
      await notifyAdapter.notifyJobChainCompleted("chain-unsubscribe");
      await sleep(NEGATIVE_ASSERTION_DELAY_MS);

      expect(callCount).toBe(0);
    });
  });

  describe("notifyJobOwnershipLost / listenJobOwnershipLost", () => {
    it("listener receives ownership lost for matching job ID", async ({ notifyAdapter }) => {
      const received = Promise.withResolvers<void>();
      const unsubscribe = await notifyAdapter.listenJobOwnershipLost("job-123", () => {
        received.resolve();
      });

      await notifyAdapter.notifyJobOwnershipLost("job-123");

      await Promise.race([
        received.promise,
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notification");
        }),
      ]);

      await unsubscribe();
    });

    it("listener does not receive ownership lost for different job ID", async ({
      notifyAdapter,
      expect,
    }) => {
      let callCount = 0;
      const unsubscribe = await notifyAdapter.listenJobOwnershipLost("job-123", () => {
        callCount++;
      });

      await notifyAdapter.notifyJobOwnershipLost("job-456");
      await sleep(NEGATIVE_ASSERTION_DELAY_MS);

      expect(callCount).toBe(0);
      await unsubscribe();
    });

    it("multiple listeners for same job ID both receive ownership lost", async ({
      notifyAdapter,
    }) => {
      const received1 = Promise.withResolvers<void>();
      const received2 = Promise.withResolvers<void>();

      const unsubscribe1 = await notifyAdapter.listenJobOwnershipLost("job-multi", () => {
        received1.resolve();
      });
      const unsubscribe2 = await notifyAdapter.listenJobOwnershipLost("job-multi", () => {
        received2.resolve();
      });

      await notifyAdapter.notifyJobOwnershipLost("job-multi");

      await Promise.race([
        Promise.all([received1.promise, received2.promise]),
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notifications");
        }),
      ]);

      await unsubscribe1();
      await unsubscribe2();
    });

    it("unsubscribe stops ownership lost notifications", async ({ notifyAdapter, expect }) => {
      let callCount = 0;
      const unsubscribe = await notifyAdapter.listenJobOwnershipLost("job-unsubscribe", () => {
        callCount++;
      });

      await unsubscribe();
      await notifyAdapter.notifyJobOwnershipLost("job-unsubscribe");
      await sleep(NEGATIVE_ASSERTION_DELAY_MS);

      expect(callCount).toBe(0);
    });
  });

  describe("cross-cutting behavior", () => {
    it("listen methods return async unsubscribe functions", async ({ notifyAdapter, expect }) => {
      const unsubscribe1 = await notifyAdapter.listenJobScheduled(["type-a"], () => {});
      const unsubscribe2 = await notifyAdapter.listenJobChainCompleted("chain-1", () => {});
      const unsubscribe3 = await notifyAdapter.listenJobOwnershipLost("job-1", () => {});

      expect(typeof unsubscribe1).toBe("function");
      expect(typeof unsubscribe2).toBe("function");
      expect(typeof unsubscribe3).toBe("function");

      const result1 = unsubscribe1();
      const result2 = unsubscribe2();
      const result3 = unsubscribe3();

      expect(result1).toBeInstanceOf(Promise);
      expect(result2).toBeInstanceOf(Promise);
      expect(result3).toBeInstanceOf(Promise);

      await result1;
      await result2;
      await result3;
    });

    it("can resubscribe after unsubscribe", async ({ notifyAdapter, expect }) => {
      const unsubscribe1 = await notifyAdapter.listenJobScheduled(["type-a"], () => {});
      await unsubscribe1();

      const received = Promise.withResolvers<string>();
      const unsubscribe2 = await notifyAdapter.listenJobScheduled(["type-a"], (typeName) => {
        received.resolve(typeName);
      });

      await notifyAdapter.notifyJobScheduled("type-a", 1);

      const result = await Promise.race([
        received.promise,
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notification");
        }),
      ]);

      expect(result).toBe("type-a");
      await unsubscribe2();
    });

    it("unsubscribe one of two listeners, remaining still receives", async ({
      notifyAdapter,
      expect,
    }) => {
      let count1 = 0;
      const received2 = Promise.withResolvers<void>();

      const unsubscribe1 = await notifyAdapter.listenJobChainCompleted("chain-partial", () => {
        count1++;
      });
      const unsubscribe2 = await notifyAdapter.listenJobChainCompleted("chain-partial", () => {
        received2.resolve();
      });

      await unsubscribe1();

      await notifyAdapter.notifyJobChainCompleted("chain-partial");

      await Promise.race([
        received2.promise,
        sleep(2000).then(() => {
          throw new Error("timeout waiting for notification");
        }),
      ]);

      expect(count1).toBe(0);
      await unsubscribe2();
    });
  });
};
