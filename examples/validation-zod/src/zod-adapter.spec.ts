import { createQueuertClient, createQueuertInProcessWorker, JobTypeValidationError } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createZodJobTypeRegistry } from "./zod-adapter.js";

describe("createZodJobTypeRegistry", () => {
  describe("validateEntry", () => {
    it("passes for entry types", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string() }) },
      });

      expect(() => {
        jobTypeRegistry.validateEntry("main");
      }).not.toThrow();
    });

    it("throws for non-entry types", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        internal: { input: z.object({ id: z.string() }) },
      });

      expect(() => {
        jobTypeRegistry.validateEntry("internal");
      }).toThrow(JobTypeValidationError);
    });

    it("throws for unknown types", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string() }) },
      });

      expect(() => {
        jobTypeRegistry.validateEntry("unknown");
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("parseInput", () => {
    it("returns parsed input for valid data", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string(), count: z.number() }) },
      });

      const result = jobTypeRegistry.parseInput("main", { id: "abc", count: 42 });
      expect(result).toEqual({ id: "abc", count: 42 });
    });

    it("throws for invalid input", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string() }) },
      });

      expect(() => {
        jobTypeRegistry.parseInput("main", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });

    it("coerces types when schema allows", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ count: z.coerce.number() }) },
      });

      const result = jobTypeRegistry.parseInput("main", { count: "42" });
      expect(result).toEqual({ count: 42 });
    });
  });

  describe("parseOutput", () => {
    it("returns parsed output for valid data", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: {
          entry: true,
          input: z.object({ id: z.string() }),
          output: z.object({ success: z.boolean() }),
        },
      });

      const result = jobTypeRegistry.parseOutput("main", { success: true });
      expect(result).toEqual({ success: true });
    });

    it("throws for invalid output", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: {
          entry: true,
          input: z.object({ id: z.string() }),
          output: z.object({ success: z.boolean() }),
        },
      });

      expect(() => {
        jobTypeRegistry.parseOutput("main", { success: "yes" });
      }).toThrow(JobTypeValidationError);
    });

    it("throws when output schema is not defined", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string() }) },
      });

      expect(() => {
        jobTypeRegistry.parseOutput("main", { success: true });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateContinueWith", () => {
    describe("nominal validation", () => {
      it("passes for valid type name", () => {
        const jobTypeRegistry = createZodJobTypeRegistry({
          step1: {
            entry: true,
            input: z.object({ id: z.string() }),
            continueWith: z.object({ typeName: z.literal("step2") }),
          },
          step2: {
            input: z.object({ data: z.unknown() }),
            output: z.object({ done: z.boolean() }),
          },
        });

        expect(() => {
          jobTypeRegistry.validateContinueWith("step1", {
            typeName: "step2",
            input: { data: "test" },
          });
        }).not.toThrow();
      });

      it("throws for invalid type name", () => {
        const jobTypeRegistry = createZodJobTypeRegistry({
          step1: {
            entry: true,
            input: z.object({ id: z.string() }),
            continueWith: z.object({ typeName: z.literal("step2") }),
          },
          step2: { input: z.object({ data: z.unknown() }) },
        });

        expect(() => {
          jobTypeRegistry.validateContinueWith("step1", { typeName: "step3", input: {} });
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching input shape", () => {
        const jobTypeRegistry = createZodJobTypeRegistry({
          router: {
            entry: true,
            input: z.object({ route: z.string() }),
            continueWith: z.object({ input: z.object({ payload: z.string() }) }),
          },
          handler: {
            input: z.object({ payload: z.string() }),
            output: z.object({ handled: z.boolean() }),
          },
        });

        expect(() => {
          jobTypeRegistry.validateContinueWith("router", {
            typeName: "handler",
            input: { payload: "test-data" },
          });
        }).not.toThrow();
      });

      it("throws for non-matching input shape", () => {
        const jobTypeRegistry = createZodJobTypeRegistry({
          router: {
            entry: true,
            input: z.object({ route: z.string() }),
            continueWith: z.object({ input: z.object({ payload: z.string() }) }),
          },
          handler: { input: z.object({ wrongField: z.string() }) },
        });

        expect(() => {
          jobTypeRegistry.validateContinueWith("router", {
            typeName: "handler",
            input: { wrongField: "test" },
          });
        }).toThrow(JobTypeValidationError);
      });
    });

    it("throws when continueWith is not defined", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        terminal: {
          entry: true,
          input: z.object({ id: z.string() }),
          output: z.object({ done: z.boolean() }),
        },
      });

      expect(() => {
        jobTypeRegistry.validateContinueWith("terminal", { typeName: "next", input: {} });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateBlockers", () => {
    describe("nominal validation", () => {
      it("passes for valid blocker type names", () => {
        const jobTypeRegistry = createZodJobTypeRegistry({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            output: z.object({ done: z.boolean() }),
            blockers: z.array(z.object({ typeName: z.literal("auth") })),
          },
          auth: {
            entry: true,
            input: z.object({ token: z.string() }),
            output: z.object({ userId: z.string() }),
          },
        });

        expect(() => {
          jobTypeRegistry.validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
        }).not.toThrow();
      });

      it("throws for invalid blocker type name", () => {
        const jobTypeRegistry = createZodJobTypeRegistry({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            blockers: z.array(z.object({ typeName: z.literal("auth") })),
          },
          auth: { entry: true, input: z.object({ token: z.string() }) },
        });

        expect(() => {
          jobTypeRegistry.validateBlockers("main", [{ typeName: "wrong", input: {} }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching blocker input shapes", () => {
        const jobTypeRegistry = createZodJobTypeRegistry({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            output: z.object({ done: z.boolean() }),
            blockers: z.array(z.object({ input: z.object({ token: z.string() }) })),
          },
          auth: {
            entry: true,
            input: z.object({ token: z.string() }),
            output: z.object({ userId: z.string() }),
          },
          authOther: {
            entry: true,
            input: z.object({ token: z.string(), extra: z.string() }),
            output: z.object({ userId: z.string() }),
          },
        });

        // Both auth types have { token: string } in input, so both are valid
        expect(() => {
          jobTypeRegistry.validateBlockers("main", [
            { typeName: "auth", input: { token: "abc" } },
            { typeName: "authOther", input: { token: "xyz", extra: "data" } },
          ]);
        }).not.toThrow();
      });

      it("throws for non-matching blocker input shape", () => {
        const jobTypeRegistry = createZodJobTypeRegistry({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            blockers: z.array(z.object({ input: z.object({ token: z.string() }) })),
          },
          config: {
            entry: true,
            input: z.object({ key: z.string() }),
          },
        });

        expect(() => {
          jobTypeRegistry.validateBlockers("main", [
            { typeName: "config", input: { key: "setting" } },
          ]);
        }).toThrow(JobTypeValidationError);
      });
    });

    it("throws when blockers is not defined", () => {
      const jobTypeRegistry = createZodJobTypeRegistry({
        main: {
          entry: true,
          input: z.object({ id: z.string() }),
          output: z.object({ done: z.boolean() }),
        },
      });

      expect(() => {
        jobTypeRegistry.validateBlockers("main", [{ typeName: "auth", input: {} }]);
      }).toThrow(JobTypeValidationError);
    });
  });
});

describe("integration", () => {
  it("runs a chain with continuation and validates at runtime", async () => {
    const jobTypeRegistry = createZodJobTypeRegistry({
      "fetch-data": {
        entry: true,
        input: z.object({ url: z.url() }),
        continueWith: z.object({ typeName: z.literal("process-data") }),
      },
      "process-data": {
        input: z.object({ data: z.unknown() }),
        output: z.object({ processed: z.boolean(), itemCount: z.number() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeRegistry,
    });
    const qrtWorker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        "fetch-data": {
          process: async ({ complete }) => {
            return complete(async ({ continueWith }) =>
              continueWith({
                typeName: "process-data",
                input: { data: { items: [1, 2, 3] } },
              }),
            );
          },
        },
        "process-data": {
          process: async ({ job, complete }) => {
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
    const jobTypeRegistry = createZodJobTypeRegistry({
      main: {
        entry: true,
        input: z.object({ url: z.url() }),
        output: z.object({ done: z.boolean() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeRegistry,
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
    const jobTypeRegistry = createZodJobTypeRegistry({
      internal: {
        input: z.object({ data: z.string() }),
        output: z.object({ done: z.boolean() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeRegistry,
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
    const jobTypeRegistry = createZodJobTypeRegistry({
      main: {
        entry: true,
        input: z.object({ id: z.string() }),
        output: z.object({ success: z.boolean() }),
        // Requires at least one blocker
        blockers: z.array(z.object({ input: z.object({ token: z.string() }) })).min(1),
      },
      auth: {
        entry: true,
        input: z.object({ token: z.string() }),
        output: z.object({ userId: z.string() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeRegistry,
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
    const jobTypeRegistry = createZodJobTypeRegistry({
      main: {
        entry: true,
        input: z.object({ id: z.string() }),
        output: z.object({ success: z.boolean() }),
        blockers: z.array(z.object({ input: z.object({ token: z.string() }) })),
      },
      auth: {
        entry: true,
        input: z.object({ token: z.string() }),
        output: z.object({ userId: z.string() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const notifyAdapter = createInProcessNotifyAdapter();
    const log = () => {};

    const qrtClient = await createQueuertClient({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeRegistry,
    });
    const qrtWorker = await createQueuertInProcessWorker({
      stateAdapter,
      notifyAdapter,
      log,
      jobTypeRegistry,
      jobTypeProcessors: {
        main: {
          process: async ({ complete }) => {
            return complete(async () => ({ success: true }));
          },
        },
        auth: {
          process: async ({ job, complete }) => {
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
