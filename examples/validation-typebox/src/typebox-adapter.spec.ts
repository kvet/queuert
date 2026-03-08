import {
  type ExternalJobTypeRegistryDefinitions,
  type JobTypeRegistryDefinitions,
  JobTypeValidationError,
  createClient,
  defineJobTypeProcessorRegistry,
  mergeJobTypeProcessorRegistries,
  mergeJobTypeRegistries,
} from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";
import { describe, expect, expectTypeOf, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { createTypeBoxJobTypeRegistry } from "./typebox-adapter.js";

describe("createTypeBoxJobTypeRegistry", () => {
  describe("getTypeNames", () => {
    it("returns all registered type names", () => {
      const registry = createTypeBoxJobTypeRegistry({
        "job-a": { entry: true, input: Type.Object({ id: Type.String() }) },
        "job-b": { input: Type.Object({ count: Type.Number() }) },
      });

      expect(registry.getTypeNames()).toEqual(["job-a", "job-b"]);
    });
  });

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
          registry.validateContinueWith("step1", {
            typeName: "step2",
            input: { data: "test" },
          });
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

  describe("external definitions (cross-slice)", () => {
    const notificationJobTypes = createTypeBoxJobTypeRegistry({
      "notifications.send-notification": {
        entry: true,
        input: Type.Object({ userId: Type.String(), message: Type.String() }),
        output: Type.Object({ sentAt: Type.String() }),
      },
    });

    const orderJobTypes = createTypeBoxJobTypeRegistry(
      {
        "orders.place-order": {
          entry: true,
          input: Type.Object({ userId: Type.String() }),
          continueWith: Type.Object({ typeName: Type.Literal("orders.confirm-order") }),
        },
        "orders.confirm-order": {
          input: Type.Object({ orderId: Type.Number() }),
          output: Type.Object({ confirmedAt: Type.String() }),
          blockers: Type.Array(
            Type.Object({ typeName: Type.Literal("notifications.send-notification") }),
          ),
        },
      },
      notificationJobTypes,
    );

    it("merges registries and validates across slices", () => {
      const merged = mergeJobTypeRegistries(orderJobTypes, notificationJobTypes);

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
      const merged = mergeJobTypeRegistries(orderJobTypes, notificationJobTypes);

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
      type OrderDefs = JobTypeRegistryDefinitions<typeof orderJobTypes>;
      type ExternalDefs = ExternalJobTypeRegistryDefinitions<typeof orderJobTypes>;

      expectTypeOf<ExternalDefs>().toHaveProperty("notifications.send-notification");
      expectTypeOf<OrderDefs>().toHaveProperty("orders.place-order");
      expectTypeOf<OrderDefs>().toHaveProperty("orders.confirm-order");
    });

    it("merges processors from typed slices", async () => {
      const stateAdapter = createInProcessStateAdapter();
      const client = await createClient({
        stateAdapter,
        registry: mergeJobTypeRegistries(orderJobTypes, notificationJobTypes),
      });
      const notificationProcessors = defineJobTypeProcessorRegistry(client, notificationJobTypes, {
        "notifications.send-notification": {
          attemptHandler: async ({ complete }) => complete(async () => ({ sentAt: "now" })),
        },
      });

      const orderProcessors = defineJobTypeProcessorRegistry(client, orderJobTypes, {
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

      const merged = mergeJobTypeProcessorRegistries(orderProcessors, notificationProcessors);

      expect(Object.keys(merged)).toEqual([
        "orders.place-order",
        "orders.confirm-order",
        "notifications.send-notification",
      ]);
    });
  });
});
