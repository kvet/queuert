import {
  type ExternalJobTypeRegistryDefinitions,
  type JobTypeRegistryDefinitions,
  JobTypeValidationError,
  createClient,
  createJobTypeProcessorRegistry,
  mergeJobTypeProcessorRegistries,
  mergeJobTypeRegistries,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createValibotJobTypeRegistry } from "./valibot-adapter.js";

describe("createValibotJobTypeRegistry", () => {
  describe("getTypeNames", () => {
    it("returns all registered type names", () => {
      const registry = createValibotJobTypeRegistry({
        "job-a": {
          entry: true,
          input: v.object({ id: v.string() }),
          continueWith: v.object({ typeName: v.literal("job-b") }),
        },
        "job-b": {
          input: v.object({ count: v.number() }),
          output: v.object({ done: v.boolean() }),
        },
      });

      expect(registry.getTypeNames()).toEqual(["job-a", "job-b"]);
    });
  });

  describe("validateEntry", () => {
    it("passes for entry types", () => {
      const registry = createValibotJobTypeRegistry({
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ ok: v.boolean() }),
        },
      });

      expect(() => {
        registry.validateEntry("main");
      }).not.toThrow();
    });

    it("throws for non-entry types", () => {
      const registry = createValibotJobTypeRegistry({
        internal: { input: v.object({ id: v.string() }), output: v.object({ ok: v.boolean() }) },
      });

      expect(() => {
        registry.validateEntry("internal");
      }).toThrow(JobTypeValidationError);
    });

    it("throws for unknown types", () => {
      const registry = createValibotJobTypeRegistry({
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ ok: v.boolean() }),
        },
      });

      expect(() => {
        registry.validateEntry("unknown");
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("parseInput", () => {
    it("returns parsed input for valid data", () => {
      const registry = createValibotJobTypeRegistry({
        main: {
          entry: true,
          input: v.object({ id: v.string(), count: v.number() }),
          output: v.object({ ok: v.boolean() }),
        },
      });

      const result = registry.parseInput("main", { id: "abc", count: 42 });
      expect(result).toEqual({ id: "abc", count: 42 });
    });

    it("throws for invalid input", () => {
      const registry = createValibotJobTypeRegistry({
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ ok: v.boolean() }),
        },
      });

      expect(() => {
        registry.parseInput("main", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });

    it("coerces types when schema allows", () => {
      const registry = createValibotJobTypeRegistry({
        main: {
          entry: true,
          input: v.object({ count: v.pipe(v.unknown(), v.transform(Number)) }),
          output: v.object({ ok: v.boolean() }),
        },
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
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          continueWith: v.object({ typeName: v.literal("next") }),
        },
        next: { input: v.object({ id: v.string() }), output: v.object({ ok: v.boolean() }) },
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
          step2: {
            input: v.object({ data: v.unknown() }),
            output: v.object({ done: v.boolean() }),
          },
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
          handler: {
            input: v.object({ payload: v.string() }),
            output: v.object({ ok: v.boolean() }),
          },
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
            output: v.object({ done: v.boolean() }),
            blockers: v.array(v.object({ input: v.object({ token: v.string() }) })),
          },
          auth: {
            entry: true,
            input: v.object({ token: v.string() }),
            output: v.object({ userId: v.string() }),
          },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "auth", input: { wrong: "data" } }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    it("rejects blockers referencing continuation-only job type", () => {
      // @ts-expect-error "internal" is a continuation-only type, cannot be a blocker
      createValibotJobTypeRegistry({
        start: {
          entry: true,
          input: v.object({ id: v.string() }),
          continueWith: v.object({ typeName: v.literal("internal") }),
        },
        internal: {
          input: v.object({ data: v.string() }),
          output: v.object({ done: v.boolean() }),
        },
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ result: v.number() }),
          blockers: v.array(v.object({ typeName: v.literal("internal") })),
        },
      });
    });

    it("allows valid blocker references", () => {
      const registry = createValibotJobTypeRegistry({
        blocker: {
          entry: true,
          input: v.object({ value: v.number() }),
          output: v.object({ result: v.number() }),
        },
        main: {
          entry: true,
          input: v.object({ id: v.string() }),
          output: v.object({ done: v.boolean() }),
          blockers: v.array(v.object({ typeName: v.literal("blocker") })),
        },
      });

      expect(registry.getTypeNames()).toEqual(["blocker", "main"]);
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

  describe("external definitions (cross-slice)", () => {
    const notificationJobTypeRegistry = createValibotJobTypeRegistry({
      "notifications.send-notification": {
        entry: true,
        input: v.object({ userId: v.string(), message: v.string() }),
        output: v.object({ sentAt: v.string() }),
      },
    });

    const orderJobTypeRegistry = createValibotJobTypeRegistry(
      {
        "orders.place-order": {
          entry: true,
          input: v.object({ userId: v.string() }),
          continueWith: v.object({ typeName: v.literal("orders.confirm-order") }),
        },
        "orders.confirm-order": {
          input: v.object({ orderId: v.number() }),
          output: v.object({ confirmedAt: v.string() }),
          blockers: v.array(v.object({ typeName: v.literal("notifications.send-notification") })),
        },
      },
      notificationJobTypeRegistry,
    );

    it("merges registries and validates across slices", () => {
      const merged = mergeJobTypeRegistries(orderJobTypeRegistry, notificationJobTypeRegistry);

      expect(merged.getTypeNames()).toEqual([
        "orders.place-order",
        "orders.confirm-order",
        "notifications.send-notification",
      ]);

      expect(() => {
        merged.validateEntry("orders.place-order");
      }).not.toThrow();

      expect(() => {
        merged.validateEntry("notifications.send-notification");
      }).not.toThrow();
    });

    it("validates cross-slice blocker references", () => {
      const merged = mergeJobTypeRegistries(orderJobTypeRegistry, notificationJobTypeRegistry);

      expect(() => {
        merged.validateBlockers("orders.confirm-order", [
          { typeName: "notifications.send-notification", input: { userId: "u1", message: "hi" } },
        ]);
      }).not.toThrow();

      expect(() => {
        merged.validateBlockers("orders.confirm-order", [{ typeName: "unknown-type", input: {} }]);
      }).toThrow(JobTypeValidationError);
    });

    it("exposes external definitions via ExternalJobTypeRegistryDefinitions", () => {
      type OrderDefs = JobTypeRegistryDefinitions<typeof orderJobTypeRegistry>;
      type ExternalDefs = ExternalJobTypeRegistryDefinitions<typeof orderJobTypeRegistry>;

      expectTypeOf<ExternalDefs>().toHaveProperty("notifications.send-notification");
      expectTypeOf<OrderDefs>().toHaveProperty("orders.place-order");
      expectTypeOf<OrderDefs>().toHaveProperty("orders.confirm-order");
    });

    it("merges processors from typed slices", async () => {
      const stateAdapter = createInProcessStateAdapter();
      const client = await createClient({
        stateAdapter,
        registry: mergeJobTypeRegistries(orderJobTypeRegistry, notificationJobTypeRegistry),
      });
      const notificationProcessorRegistry = createJobTypeProcessorRegistry(
        client,
        notificationJobTypeRegistry,
        {
          "notifications.send-notification": {
            attemptHandler: async ({ complete }) => complete(async () => ({ sentAt: "now" })),
          },
        },
      );

      const orderProcessorRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
        "orders.place-order": {
          attemptHandler: async ({ complete }) =>
            complete(async ({ continueWith }) =>
              continueWith({
                typeName: "orders.confirm-order",
                input: { orderId: 1 },
                blockers: [] as never,
              }),
            ),
        },
        "orders.confirm-order": {
          attemptHandler: async ({ job, complete }) => {
            expectTypeOf(job.blockers[0].output).toEqualTypeOf<{ sentAt: string }>();
            return complete(async () => ({ confirmedAt: "now" }));
          },
        },
      });

      const merged = mergeJobTypeProcessorRegistries(
        orderProcessorRegistry,
        notificationProcessorRegistry,
      );

      expect(Object.keys(merged)).toEqual([
        "orders.place-order",
        "orders.confirm-order",
        "notifications.send-notification",
      ]);
    });
  });
});
