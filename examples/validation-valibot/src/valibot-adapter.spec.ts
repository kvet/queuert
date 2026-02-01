import { JobTypeValidationError, createClient, createInProcessWorker } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { describe, expect, it } from "vitest";
import * as v from "valibot";
import { createValibotJobTypeRegistry } from "./valibot-adapter.js";

describe("createValibotJobTypeRegistry", () => {
  describe("validateEntry", () => {
    it("passes for entry types", () => {
      const registry = createValibotJobTypeRegistry({
        main: { entry: true, input: v.object({ id: v.string() }) },
      });

      expect(() => {
        registry.validateEntry("main");
      }).not.toThrow();
    });

    it("throws for non-entry types", () => {
      const registry = createValibotJobTypeRegistry({
        internal: { input: v.object({ id: v.string() }) },
      });

      expect(() => {
        registry.validateEntry("internal");
      }).toThrow(JobTypeValidationError);
    });

    it("throws for unknown types", () => {
      const registry = createValibotJobTypeRegistry({
        main: { entry: true, input: v.object({ id: v.string() }) },
      });

      expect(() => {
        registry.validateEntry("unknown");
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("parseInput", () => {
    it("returns parsed input for valid data", () => {
      const registry = createValibotJobTypeRegistry({
        main: { entry: true, input: v.object({ id: v.string(), count: v.number() }) },
      });

      const result = registry.parseInput("main", { id: "abc", count: 42 });
      expect(result).toEqual({ id: "abc", count: 42 });
    });

    it("throws for invalid input", () => {
      const registry = createValibotJobTypeRegistry({
        main: { entry: true, input: v.object({ id: v.string() }) },
      });

      expect(() => {
        registry.parseInput("main", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });

    it("coerces types when schema allows", () => {
      const registry = createValibotJobTypeRegistry({
        main: { entry: true, input: v.object({ count: v.pipe(v.unknown(), v.transform(Number)) }) },
      });

      const result = registry.parseInput("main", { count: "42" });
      expect(result).toEqual({ count: 42 });
    });
  });

  describe("parseOutput", () => {
    it("returns parsed output for valid data", () => {
      const registry = createValibotJobTypeRegistry({
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ success: v.boolean() }),
        },
      });

      const result = registry.parseOutput("main", { success: true });
      expect(result).toEqual({ success: true });
    });

    it("throws for invalid output", () => {
      const registry = createValibotJobTypeRegistry({
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ success: v.boolean() }),
        },
      });

      expect(() => {
        registry.parseOutput("main", { success: "yes" });
      }).toThrow(JobTypeValidationError);
    });

    it("throws when output schema is not defined", () => {
      const registry = createValibotJobTypeRegistry({
        main: { entry: true, input: v.object({ id: v.string() }) },
      });

      expect(() => {
        registry.parseOutput("main", { success: true });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateContinueWith", () => {
    describe("nominal validation", () => {
      it("passes for valid type name", () => {
        const registry = createValibotJobTypeRegistry({
          step1: {
            entry: true,
            input: v.object({ id: v.string() }),
            continueWith: v.object({ typeName: v.literal("step2") }),
          },
          step2: {
            input: v.object({ data: v.unknown() }),
            output: v.object({ done: v.boolean() }),
          },
        });

        expect(() => {
          registry.validateContinueWith("step1", {
            typeName: "step2",
            input: { data: "test" },
          });
        }).not.toThrow();
      });

      it("throws for invalid type name", () => {
        const registry = createValibotJobTypeRegistry({
          step1: {
            entry: true,
            input: v.object({ id: v.string() }),
            continueWith: v.object({ typeName: v.literal("step2") }),
          },
          step2: { input: v.object({ data: v.unknown() }) },
        });

        expect(() => {
          registry.validateContinueWith("step1", { typeName: "step3", input: {} });
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching input shape", () => {
        const registry = createValibotJobTypeRegistry({
          router: {
            entry: true,
            input: v.object({ route: v.string() }),
            continueWith: v.object({ input: v.object({ payload: v.string() }) }),
          },
          handler: {
            input: v.object({ payload: v.string() }),
            output: v.object({ handled: v.boolean() }),
          },
        });

        expect(() => {
          registry.validateContinueWith("router", {
            typeName: "handler",
            input: { payload: "test-data" },
          });
        }).not.toThrow();
      });

      it("throws for non-matching input shape", () => {
        const registry = createValibotJobTypeRegistry({
          router: {
            entry: true,
            input: v.object({ route: v.string() }),
            continueWith: v.object({ input: v.object({ payload: v.string() }) }),
          },
          handler: { input: v.object({ wrongField: v.string() }) },
        });

        expect(() => {
          registry.validateContinueWith("router", {
            typeName: "handler",
            input: { wrongField: "test" },
          });
        }).toThrow(JobTypeValidationError);
      });
    });

    it("throws when continueWith is not defined", () => {
      const registry = createValibotJobTypeRegistry({
        terminal: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ done: v.boolean() }),
        },
      });

      expect(() => {
        registry.validateContinueWith("terminal", { typeName: "next", input: {} });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateBlockers", () => {
    describe("nominal validation", () => {
      it("passes for valid blocker type names", () => {
        const registry = createValibotJobTypeRegistry({
          main: {
            entry: true,
            input: v.object({ id: v.string() }),
            output: v.object({ done: v.boolean() }),
            blockers: v.array(v.object({ typeName: v.literal("auth") })),
          },
          auth: {
            entry: true,
            input: v.object({ token: v.string() }),
            output: v.object({ userId: v.string() }),
          },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
        }).not.toThrow();
      });

      it("throws for invalid blocker type name", () => {
        const registry = createValibotJobTypeRegistry({
          main: {
            entry: true,
            input: v.object({ id: v.string() }),
            blockers: v.array(v.object({ typeName: v.literal("auth") })),
          },
          auth: { entry: true, input: v.object({ token: v.string() }) },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "wrong", input: {} }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching blocker input shapes", () => {
        const registry = createValibotJobTypeRegistry({
          main: {
            entry: true,
            input: v.object({ id: v.string() }),
            output: v.object({ done: v.boolean() }),
            blockers: v.array(v.object({ input: v.object({ token: v.string() }) })),
          },
          auth: {
            entry: true,
            input: v.object({ token: v.string() }),
            output: v.object({ userId: v.string() }),
          },
          authOther: {
            entry: true,
            input: v.object({ token: v.string(), extra: v.string() }),
            output: v.object({ userId: v.string() }),
          },
        });

        // Both auth types have { token: string } in input, so both are valid
        expect(() => {
          registry.validateBlockers("main", [
            { typeName: "auth", input: { token: "abc" } },
            { typeName: "authOther", input: { token: "xyz", extra: "data" } },
          ]);
        }).not.toThrow();
      });

      it("throws for non-matching blocker input shape", () => {
        const registry = createValibotJobTypeRegistry({
          main: {
            entry: true,
            input: v.object({ id: v.string() }),
            blockers: v.array(v.object({ input: v.object({ token: v.string() }) })),
          },
          config: {
            entry: true,
            input: v.object({ key: v.string() }),
          },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "config", input: { key: "setting" } }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    it("throws when blockers is not defined", () => {
      const registry = createValibotJobTypeRegistry({
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ done: v.boolean() }),
        },
      });

      expect(() => {
        registry.validateBlockers("main", [{ typeName: "auth", input: {} }]);
      }).toThrow(JobTypeValidationError);
    });
  });
});

describe("integration", () => {
  it("runs a chain with continuation and validates at runtime", async () => {
    const registry = createValibotJobTypeRegistry({
      "fetch-data": {
        entry: true,
        input: v.object({ url: v.pipe(v.string(), v.url()) }),
        continueWith: v.object({ typeName: v.literal("process-data") }),
      },
      "process-data": {
        input: v.object({ data: v.unknown() }),
        output: v.object({ processed: v.boolean(), itemCount: v.number() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createClient({
      stateAdapter,
      notifyAdapter,
      log,
      registry,
    });
    const qrtWorker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      log,
      registry,
      processors: {
        "fetch-data": {
          attemptHandler: async ({ complete }) => {
            return complete(async ({ continueWith }) =>
              continueWith({
                typeName: "process-data",
                input: { data: { items: [1, 2, 3] } },
              }),
            );
          },
        },
        "process-data": {
          attemptHandler: async ({ job, complete }) => {
            const data = job.input.data as { items: number[] };
            return complete(async () => ({
              processed: true,
              itemCount: data.items.length,
            }));
          },
        },
      },
    });

    const stop = await qrtWorker.start();

    const chain = await qrtClient.withNotify(async () =>
      stateAdapter.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          typeName: "fetch-data",
          input: { url: "https://example.com/api" },
        }),
      ),
    );

    const result = await qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 5000 });
    expect(result.output).toEqual({ processed: true, itemCount: 3 });

    await stop();
  });

  it("rejects invalid input at chain start", async () => {
    const registry = createValibotJobTypeRegistry({
      main: {
        entry: true,
        input: v.object({ url: v.pipe(v.string(), v.url()) }),
        output: v.object({ done: v.boolean() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createClient({
      stateAdapter,
      notifyAdapter,
      log,
      registry,
    });

    await expect(
      qrtClient.withNotify(async () =>
        stateAdapter.runInTransaction(async (ctx) =>
          qrtClient.startJobChain({
            ...ctx,
            typeName: "main",
            input: { url: "not-a-valid-url" },
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects non-entry type at chain start", async () => {
    const registry = createValibotJobTypeRegistry({
      internal: {
        input: v.object({ data: v.string() }),
        output: v.object({ done: v.boolean() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createClient({
      stateAdapter,
      notifyAdapter,
      log,
      registry,
    });

    await expect(
      qrtClient.withNotify(async () =>
        stateAdapter.runInTransaction(async (ctx) =>
          qrtClient.startJobChain({
            ...ctx,
            // @ts-ignore to test runtime validation
            typeName: "internal",
            // @ts-ignore to test runtime validation
            input: { data: "test" },
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects when required blockers are not provided", async () => {
    const registry = createValibotJobTypeRegistry({
      main: {
        entry: true,
        input: v.object({ id: v.string() }),
        output: v.object({ success: v.boolean() }),
        // Requires at least one blocker
        blockers: v.pipe(
          v.array(v.object({ input: v.object({ token: v.string() }) })),
          v.minLength(1),
        ),
      },
      auth: {
        entry: true,
        input: v.object({ token: v.string() }),
        output: v.object({ userId: v.string() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createClient({
      stateAdapter,
      notifyAdapter,
      log,
      registry,
    });

    // Starting without startBlockers should fail validation
    // Use type assertion to bypass compile-time check and test runtime validation
    await expect(
      qrtClient.withNotify(async () =>
        stateAdapter.runInTransaction(async (ctx) =>
          qrtClient.startJobChain(
            // @ts-ignore to test runtime validation
            {
              ...ctx,
              typeName: "main",
              input: { id: "main-1" },
              // No startBlockers provided, but blockers are required
            },
          ),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("runs a chain with structural blocker validation", async () => {
    const registry = createValibotJobTypeRegistry({
      main: {
        entry: true,
        input: v.object({ id: v.string() }),
        output: v.object({ success: v.boolean() }),
        blockers: v.array(v.object({ input: v.object({ token: v.string() }) })),
      },
      auth: {
        entry: true,
        input: v.object({ token: v.string() }),
        output: v.object({ userId: v.string() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createClient({
      stateAdapter,
      notifyAdapter,
      log,
      registry,
    });
    const qrtWorker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      log,
      registry,
      processors: {
        main: {
          attemptHandler: async ({ complete }) => {
            return complete(async () => ({ success: true }));
          },
        },
        auth: {
          attemptHandler: async ({ job, complete }) => {
            return complete(async () => ({ userId: `user-${job.input.token}` }));
          },
        },
      },
    });

    const stop = await qrtWorker.start();

    const chain = await qrtClient.withNotify(async () =>
      stateAdapter.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          typeName: "main",
          input: { id: "main-1" },
          startBlockers: async () => {
            const blocker = await qrtClient.startJobChain({
              ...ctx,
              typeName: "auth",
              input: { token: "abc123" },
            });
            return [blocker];
          },
        }),
      ),
    );

    const result = await qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 5000 });
    expect(result.output).toEqual({ success: true });

    await stop();
  });
});
