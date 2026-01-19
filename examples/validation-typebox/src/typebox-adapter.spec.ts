import { createQueuertClient, createQueuertInProcessWorker, JobTypeValidationError } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { createTypeBoxJobTypeRegistry } from "./typebox-adapter.js";

describe("createTypeBoxJobTypeRegistry", () => {
  describe("validateEntry", () => {
    it("passes for entry types", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        jobTypeRegistry.validateEntry("main");
      }).not.toThrow();
    });

    it("throws for non-entry types", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        internal: { input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        jobTypeRegistry.validateEntry("internal");
      }).toThrow(JobTypeValidationError);
    });

    it("throws for unknown types", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        jobTypeRegistry.validateEntry("unknown");
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("parseInput", () => {
    it("returns parsed input for valid data", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String(), count: Type.Number() }) },
      });

      const result = jobTypeRegistry.parseInput("main", { id: "abc", count: 42 });
      expect(result).toEqual({ id: "abc", count: 42 });
    });

    it("throws for invalid input", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        jobTypeRegistry.parseInput("main", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });

    it("coerces types when schema allows", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: {
          entry: true,
          input: Type.Object({
            count: Type.Transform(Type.Unknown()).Decode(Number).Encode(Number),
          }),
        },
      });

      const result = jobTypeRegistry.parseInput("main", { count: "42" });
      expect(result).toEqual({ count: 42 });
    });
  });

  describe("parseOutput", () => {
    it("returns parsed output for valid data", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: {
          entry: true,
          input: Type.Object({ id: Type.String() }),
          output: Type.Object({ success: Type.Boolean() }),
        },
      });

      const result = jobTypeRegistry.parseOutput("main", { success: true });
      expect(result).toEqual({ success: true });
    });

    it("throws for invalid output", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: {
          entry: true,
          input: Type.Object({ id: Type.String() }),
          output: Type.Object({ success: Type.Boolean() }),
        },
      });

      expect(() => {
        jobTypeRegistry.parseOutput("main", { success: "yes" });
      }).toThrow(JobTypeValidationError);
    });

    it("throws when output schema is not defined", () => {
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        jobTypeRegistry.parseOutput("main", { success: true });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateContinueWith", () => {
    describe("nominal validation", () => {
      it("passes for valid type name", () => {
        const jobTypeRegistry = createTypeBoxJobTypeRegistry({
          step1: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            continueWith: Type.Object({ typeName: Type.Literal("step2") }),
          },
          step2: {
            input: Type.Object({ data: Type.Unknown() }),
            output: Type.Object({ done: Type.Boolean() }),
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
        const jobTypeRegistry = createTypeBoxJobTypeRegistry({
          step1: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            continueWith: Type.Object({ typeName: Type.Literal("step2") }),
          },
          step2: { input: Type.Object({ data: Type.Unknown() }) },
        });

        expect(() => {
          jobTypeRegistry.validateContinueWith("step1", { typeName: "step3", input: {} });
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching input shape", () => {
        const jobTypeRegistry = createTypeBoxJobTypeRegistry({
          router: {
            entry: true,
            input: Type.Object({ route: Type.String() }),
            continueWith: Type.Object({ input: Type.Object({ payload: Type.String() }) }),
          },
          handler: {
            input: Type.Object({ payload: Type.String() }),
            output: Type.Object({ handled: Type.Boolean() }),
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
        const jobTypeRegistry = createTypeBoxJobTypeRegistry({
          router: {
            entry: true,
            input: Type.Object({ route: Type.String() }),
            continueWith: Type.Object({ input: Type.Object({ payload: Type.String() }) }),
          },
          handler: { input: Type.Object({ wrongField: Type.String() }) },
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
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        terminal: {
          entry: true,
          input: Type.Object({ id: Type.String() }),
          output: Type.Object({ done: Type.Boolean() }),
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
        const jobTypeRegistry = createTypeBoxJobTypeRegistry({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            output: Type.Object({ done: Type.Boolean() }),
            blockers: Type.Array(Type.Object({ typeName: Type.Literal("auth") })),
          },
          auth: {
            entry: true,
            input: Type.Object({ token: Type.String() }),
            output: Type.Object({ userId: Type.String() }),
          },
        });

        expect(() => {
          jobTypeRegistry.validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
        }).not.toThrow();
      });

      it("throws for invalid blocker type name", () => {
        const jobTypeRegistry = createTypeBoxJobTypeRegistry({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            blockers: Type.Array(Type.Object({ typeName: Type.Literal("auth") })),
          },
          auth: { entry: true, input: Type.Object({ token: Type.String() }) },
        });

        expect(() => {
          jobTypeRegistry.validateBlockers("main", [{ typeName: "wrong", input: {} }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching blocker input shapes", () => {
        const jobTypeRegistry = createTypeBoxJobTypeRegistry({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            output: Type.Object({ done: Type.Boolean() }),
            blockers: Type.Array(Type.Object({ input: Type.Object({ token: Type.String() }) })),
          },
          auth: {
            entry: true,
            input: Type.Object({ token: Type.String() }),
            output: Type.Object({ userId: Type.String() }),
          },
          authOther: {
            entry: true,
            input: Type.Object({ token: Type.String(), extra: Type.String() }),
            output: Type.Object({ userId: Type.String() }),
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
        const jobTypeRegistry = createTypeBoxJobTypeRegistry({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            blockers: Type.Array(Type.Object({ input: Type.Object({ token: Type.String() }) })),
          },
          config: {
            entry: true,
            input: Type.Object({ key: Type.String() }),
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
      const jobTypeRegistry = createTypeBoxJobTypeRegistry({
        main: {
          entry: true,
          input: Type.Object({ id: Type.String() }),
          output: Type.Object({ done: Type.Boolean() }),
        },
      });

      expect(() => {
        jobTypeRegistry.validateBlockers("main", [{ typeName: "auth", input: {} }]);
      }).toThrow(JobTypeValidationError);
    });
  });
});

// URL format for TypeBox (simplified pattern)
const UrlString = Type.String({ pattern: "^https?://" });

describe("integration", () => {
  it("runs a chain with continuation and validates at runtime", async () => {
    const jobTypeRegistry = createTypeBoxJobTypeRegistry({
      "fetch-data": {
        entry: true,
        input: Type.Object({ url: UrlString }),
        continueWith: Type.Object({ typeName: Type.Literal("process-data") }),
      },
      "process-data": {
        input: Type.Object({ data: Type.Unknown() }),
        output: Type.Object({ processed: Type.Boolean(), itemCount: Type.Number() }),
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
    const jobTypeRegistry = createTypeBoxJobTypeRegistry({
      main: {
        entry: true,
        input: Type.Object({ url: UrlString }),
        output: Type.Object({ done: Type.Boolean() }),
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
    const jobTypeRegistry = createTypeBoxJobTypeRegistry({
      internal: {
        input: Type.Object({ data: Type.String() }),
        output: Type.Object({ done: Type.Boolean() }),
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
    const jobTypeRegistry = createTypeBoxJobTypeRegistry({
      main: {
        entry: true,
        input: Type.Object({ id: Type.String() }),
        output: Type.Object({ success: Type.Boolean() }),
        // Requires at least one blocker
        blockers: Type.Array(Type.Object({ input: Type.Object({ token: Type.String() }) }), {
          minItems: 1,
        }),
      },
      auth: {
        entry: true,
        input: Type.Object({ token: Type.String() }),
        output: Type.Object({ userId: Type.String() }),
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
    const jobTypeRegistry = createTypeBoxJobTypeRegistry({
      main: {
        entry: true,
        input: Type.Object({ id: Type.String() }),
        output: Type.Object({ success: Type.Boolean() }),
        blockers: Type.Array(Type.Object({ input: Type.Object({ token: Type.String() }) })),
      },
      auth: {
        entry: true,
        input: Type.Object({ token: Type.String() }),
        output: Type.Object({ userId: Type.String() }),
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
