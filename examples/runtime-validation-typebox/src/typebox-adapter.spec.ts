import {
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
  createQueuert,
  JobTypeValidationError,
} from "queuert";
import { describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { createTypeBoxJobTypeRegistry } from "./typebox-adapter.js";

describe("createTypeBoxJobTypeRegistry", () => {
  describe("validateEntry", () => {
    it("passes for entry types", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        registry.validateEntry("main");
      }).not.toThrow();
    });

    it("throws for non-entry types", () => {
      const registry = createTypeBoxJobTypeRegistry({
        internal: { input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        registry.validateEntry("internal");
      }).toThrow(JobTypeValidationError);
    });

    it("throws for unknown types", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        registry.validateEntry("unknown");
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("parseInput", () => {
    it("returns parsed input for valid data", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String(), count: Type.Number() }) },
      });

      const result = registry.parseInput("main", { id: "abc", count: 42 });
      expect(result).toEqual({ id: "abc", count: 42 });
    });

    it("throws for invalid input", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        registry.parseInput("main", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });

    it("coerces types when schema allows", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: {
          entry: true,
          input: Type.Object({
            count: Type.Transform(Type.Unknown()).Decode(Number).Encode(Number),
          }),
        },
      });

      const result = registry.parseInput("main", { count: "42" });
      expect(result).toEqual({ count: 42 });
    });
  });

  describe("parseOutput", () => {
    it("returns parsed output for valid data", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: {
          entry: true,
          input: Type.Object({ id: Type.String() }),
          output: Type.Object({ success: Type.Boolean() }),
        },
      });

      const result = registry.parseOutput("main", { success: true });
      expect(result).toEqual({ success: true });
    });

    it("throws for invalid output", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: {
          entry: true,
          input: Type.Object({ id: Type.String() }),
          output: Type.Object({ success: Type.Boolean() }),
        },
      });

      expect(() => {
        registry.parseOutput("main", { success: "yes" });
      }).toThrow(JobTypeValidationError);
    });

    it("throws when output schema is not defined", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: { entry: true, input: Type.Object({ id: Type.String() }) },
      });

      expect(() => {
        registry.parseOutput("main", { success: true });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateContinueWith", () => {
    describe("nominal validation", () => {
      it("passes for valid type name", () => {
        const registry = createTypeBoxJobTypeRegistry({
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
          registry.validateContinueWith("step1", { typeName: "step2", input: { data: "test" } });
        }).not.toThrow();
      });

      it("throws for invalid type name", () => {
        const registry = createTypeBoxJobTypeRegistry({
          step1: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            continueWith: Type.Object({ typeName: Type.Literal("step2") }),
          },
          step2: { input: Type.Object({ data: Type.Unknown() }) },
        });

        expect(() => {
          registry.validateContinueWith("step1", { typeName: "step3", input: {} });
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching input shape", () => {
        const registry = createTypeBoxJobTypeRegistry({
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
          registry.validateContinueWith("router", {
            typeName: "handler",
            input: { payload: "test-data" },
          });
        }).not.toThrow();
      });

      it("throws for non-matching input shape", () => {
        const registry = createTypeBoxJobTypeRegistry({
          router: {
            entry: true,
            input: Type.Object({ route: Type.String() }),
            continueWith: Type.Object({ input: Type.Object({ payload: Type.String() }) }),
          },
          handler: { input: Type.Object({ wrongField: Type.String() }) },
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
      const registry = createTypeBoxJobTypeRegistry({
        terminal: {
          entry: true,
          input: Type.Object({ id: Type.String() }),
          output: Type.Object({ done: Type.Boolean() }),
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
        const registry = createTypeBoxJobTypeRegistry({
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
          registry.validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
        }).not.toThrow();
      });

      it("throws for invalid blocker type name", () => {
        const registry = createTypeBoxJobTypeRegistry({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            blockers: Type.Array(Type.Object({ typeName: Type.Literal("auth") })),
          },
          auth: { entry: true, input: Type.Object({ token: Type.String() }) },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "wrong", input: {} }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching blocker input shapes", () => {
        const registry = createTypeBoxJobTypeRegistry({
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
          registry.validateBlockers("main", [
            { typeName: "auth", input: { token: "abc" } },
            { typeName: "authOther", input: { token: "xyz", extra: "data" } },
          ]);
        }).not.toThrow();
      });

      it("throws for non-matching blocker input shape", () => {
        const registry = createTypeBoxJobTypeRegistry({
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
          registry.validateBlockers("main", [{ typeName: "config", input: { key: "setting" } }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    it("throws when blockers is not defined", () => {
      const registry = createTypeBoxJobTypeRegistry({
        main: {
          entry: true,
          input: Type.Object({ id: Type.String() }),
          output: Type.Object({ done: Type.Boolean() }),
        },
      });

      expect(() => {
        registry.validateBlockers("main", [{ typeName: "auth", input: {} }]);
      }).toThrow(JobTypeValidationError);
    });
  });
});

// URL format for TypeBox (simplified pattern)
const UrlString = Type.String({ pattern: "^https?://" });

describe("integration", () => {
  it("runs a sequence with continuation and validates at runtime", async () => {
    const registry = createTypeBoxJobTypeRegistry({
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
    const qrt = await createQueuert({
      stateAdapter,
      notifyAdapter: createInProcessNotifyAdapter(),
      log: () => {},
      jobTypeRegistry: registry,
    });

    const worker = qrt
      .createWorker()
      .implementJobType({
        typeName: "fetch-data",
        process: async ({ complete }) => {
          return complete(async ({ continueWith }) =>
            continueWith({
              typeName: "process-data",
              input: { data: { items: [1, 2, 3] } },
            }),
          );
        },
      })
      .implementJobType({
        typeName: "process-data",
        process: async ({ job, complete }) => {
          const data = job.input.data as { items: number[] };
          return complete(async () => ({
            processed: true,
            itemCount: data.items.length,
          }));
        },
      });

    const stop = await worker.start({ workerId: "test-worker" });

    const sequence = await qrt.withNotify(async () =>
      stateAdapter.provideContext(async (ctx) =>
        stateAdapter.runInTransaction(ctx, async (ctx) =>
          qrt.startJobSequence({
            ...ctx,
            typeName: "fetch-data",
            input: { url: "https://example.com/api" },
          }),
        ),
      ),
    );

    const result = await qrt.waitForJobSequenceCompletion(sequence, { timeoutMs: 5000 });
    expect(result.output).toEqual({ processed: true, itemCount: 3 });

    await stop();
  });

  it("rejects invalid input at sequence start", async () => {
    const registry = createTypeBoxJobTypeRegistry({
      main: {
        entry: true,
        input: Type.Object({ url: UrlString }),
        output: Type.Object({ done: Type.Boolean() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const qrt = await createQueuert({
      stateAdapter,
      notifyAdapter: createInProcessNotifyAdapter(),
      log: () => {},
      jobTypeRegistry: registry,
    });

    await expect(
      qrt.withNotify(async () =>
        stateAdapter.provideContext(async (ctx) =>
          stateAdapter.runInTransaction(ctx, async (ctx) =>
            qrt.startJobSequence({
              ...ctx,
              typeName: "main",
              input: { url: "not-a-valid-url" },
            }),
          ),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects non-entry type at sequence start", async () => {
    const registry = createTypeBoxJobTypeRegistry({
      internal: {
        input: Type.Object({ data: Type.String() }),
        output: Type.Object({ done: Type.Boolean() }),
      },
    });

    const stateAdapter = createInProcessStateAdapter();
    const qrt = await createQueuert({
      stateAdapter,
      notifyAdapter: createInProcessNotifyAdapter(),
      log: () => {},
      jobTypeRegistry: registry,
    });

    await expect(
      qrt.withNotify(async () =>
        stateAdapter.provideContext(async (ctx) =>
          stateAdapter.runInTransaction(ctx, async (ctx) =>
            qrt.startJobSequence({
              ...ctx,
              // @ts-ignore to test runtime validation
              typeName: "internal",
              // @ts-ignore to test runtime validation
              input: { data: "test" },
            }),
          ),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects when required blockers are not provided", async () => {
    const registry = createTypeBoxJobTypeRegistry({
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
    const qrt = await createQueuert({
      stateAdapter,
      notifyAdapter: createInProcessNotifyAdapter(),
      log: () => {},
      jobTypeRegistry: registry,
    });

    // Starting without startBlockers should fail validation
    // Use type assertion to bypass compile-time check and test runtime validation
    await expect(
      qrt.withNotify(async () =>
        stateAdapter.provideContext(async (ctx) =>
          stateAdapter.runInTransaction(ctx, async (ctx) =>
            qrt.startJobSequence(
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
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("runs a sequence with structural blocker validation", async () => {
    const registry = createTypeBoxJobTypeRegistry({
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
    const qrt = await createQueuert({
      stateAdapter,
      notifyAdapter: createInProcessNotifyAdapter(),
      log: () => {},
      jobTypeRegistry: registry,
    });

    const worker = qrt
      .createWorker()
      .implementJobType({
        typeName: "main",
        process: async ({ complete }) => {
          return complete(async () => ({ success: true }));
        },
      })
      .implementJobType({
        typeName: "auth",
        process: async ({ job, complete }) => {
          return complete(async () => ({ userId: `user-${job.input.token}` }));
        },
      });

    const stop = await worker.start({ workerId: "test-worker" });

    const sequence = await qrt.withNotify(async () =>
      stateAdapter.provideContext(async (ctx) =>
        stateAdapter.runInTransaction(ctx, async (ctx) =>
          qrt.startJobSequence({
            ...ctx,
            typeName: "main",
            input: { id: "main-1" },
            startBlockers: async () => {
              const blocker = await qrt.startJobSequence({
                ...ctx,
                typeName: "auth",
                input: { token: "abc123" },
              });
              return [blocker];
            },
          }),
        ),
      ),
    );

    const result = await qrt.waitForJobSequenceCompletion(sequence, { timeoutMs: 5000 });
    expect(result.output).toEqual({ success: true });

    await stop();
  });
});
