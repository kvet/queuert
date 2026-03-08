import { type } from "arktype";
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
import { createArkTypeJobTypeRegistry } from "./arktype-adapter.js";

describe("createArkTypeJobTypeRegistry", () => {
  describe("getTypeNames", () => {
    it("returns all registered type names", () => {
      const registry = createArkTypeJobTypeRegistry({
        "job-a": { entry: true, input: type({ id: "string" }) },
        "job-b": { input: type({ count: "number" }) },
      });

      expect(registry.getTypeNames()).toEqual(["job-a", "job-b"]);
    });
  });

  describe("validateEntry", () => {
    it("passes for entry types", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: { entry: true, input: type({ id: "string" }) },
      });

      expect(() => {
        registry.validateEntry("main");
      }).not.toThrow();
    });

    it("throws for non-entry types", () => {
      const registry = createArkTypeJobTypeRegistry({
        internal: { input: type({ id: "string" }) },
      });

      expect(() => {
        registry.validateEntry("internal");
      }).toThrow(JobTypeValidationError);
    });

    it("throws for unknown types", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: { entry: true, input: type({ id: "string" }) },
      });

      expect(() => {
        registry.validateEntry("unknown");
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("parseInput", () => {
    it("returns parsed input for valid data", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: { entry: true, input: type({ id: "string", count: "number" }) },
      });

      const result = registry.parseInput("main", { id: "abc", count: 42 });
      expect(result).toEqual({ id: "abc", count: 42 });
    });

    it("throws for invalid input", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: { entry: true, input: type({ id: "string" }) },
      });

      expect(() => {
        registry.parseInput("main", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });

    it("coerces types when schema allows", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: { entry: true, input: type({ count: "string.numeric.parse" }) },
      });

      const result = registry.parseInput("main", { count: "42" });
      expect(result).toEqual({ count: 42 });
    });
  });

  describe("parseOutput", () => {
    it("returns parsed output for valid data", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: {
          entry: true,
          input: type({ id: "string" }),
          output: type({ success: "boolean" }),
        },
      });

      const result = registry.parseOutput("main", { success: true });
      expect(result).toEqual({ success: true });
    });

    it("throws for invalid output", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: {
          entry: true,
          input: type({ id: "string" }),
          output: type({ success: "boolean" }),
        },
      });

      expect(() => {
        registry.parseOutput("main", { success: "yes" });
      }).toThrow(JobTypeValidationError);
    });

    it("throws when output schema is not defined", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: { entry: true, input: type({ id: "string" }) },
      });

      expect(() => {
        registry.parseOutput("main", { success: true });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateContinueWith", () => {
    describe("nominal validation", () => {
      it("passes for valid type name", () => {
        const registry = createArkTypeJobTypeRegistry({
          step1: {
            entry: true,
            input: type({ id: "string" }),
            continueWith: type({ typeName: "'step2'" }),
          },
          step2: {
            input: type({ data: "unknown" }),
            output: type({ done: "boolean" }),
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
        const registry = createArkTypeJobTypeRegistry({
          step1: {
            entry: true,
            input: type({ id: "string" }),
            continueWith: type({ typeName: "'step2'" }),
          },
          step2: { input: type({ data: "unknown" }) },
        });

        expect(() => {
          registry.validateContinueWith("step1", { typeName: "step3", input: {} });
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching input shape", () => {
        const registry = createArkTypeJobTypeRegistry({
          router: {
            entry: true,
            input: type({ route: "string" }),
            continueWith: type({ input: { payload: "string" } }),
          },
          handler: {
            input: type({ payload: "string" }),
            output: type({ handled: "boolean" }),
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
        const registry = createArkTypeJobTypeRegistry({
          router: {
            entry: true,
            input: type({ route: "string" }),
            continueWith: type({ input: { payload: "string" } }),
          },
          handler: { input: type({ wrongField: "string" }) },
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
      const registry = createArkTypeJobTypeRegistry({
        terminal: {
          entry: true,
          input: type({ id: "string" }),
          output: type({ done: "boolean" }),
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
        const registry = createArkTypeJobTypeRegistry({
          main: {
            entry: true,
            input: type({ id: "string" }),
            output: type({ done: "boolean" }),
            blockers: type({ typeName: "'auth'" }).array(),
          },
          auth: {
            entry: true,
            input: type({ token: "string" }),
            output: type({ userId: "string" }),
          },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
        }).not.toThrow();
      });

      it("throws for invalid blocker type name", () => {
        const registry = createArkTypeJobTypeRegistry({
          main: {
            entry: true,
            input: type({ id: "string" }),
            blockers: type({ typeName: "'auth'" }).array(),
          },
          auth: { entry: true, input: type({ token: "string" }) },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "wrong", input: {} }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching blocker input shapes", () => {
        const registry = createArkTypeJobTypeRegistry({
          main: {
            entry: true,
            input: type({ id: "string" }),
            output: type({ done: "boolean" }),
            blockers: type({ input: { token: "string" } }).array(),
          },
          auth: {
            entry: true,
            input: type({ token: "string" }),
            output: type({ userId: "string" }),
          },
          authOther: {
            entry: true,
            input: type({ token: "string", extra: "string" }),
            output: type({ userId: "string" }),
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
        const registry = createArkTypeJobTypeRegistry({
          main: {
            entry: true,
            input: type({ id: "string" }),
            blockers: type({ input: { token: "string" } }).array(),
          },
          config: {
            entry: true,
            input: type({ key: "string" }),
          },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "config", input: { key: "setting" } }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    it("throws when blockers is not defined", () => {
      const registry = createArkTypeJobTypeRegistry({
        main: {
          entry: true,
          input: type({ id: "string" }),
          output: type({ done: "boolean" }),
        },
      });

      expect(() => {
        registry.validateBlockers("main", [{ typeName: "auth", input: {} }]);
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("external definitions (cross-slice)", () => {
    const notificationJobTypes = createArkTypeJobTypeRegistry({
      "notifications.send-notification": {
        entry: true,
        input: type({ userId: "string", message: "string" }),
        output: type({ sentAt: "string" }),
      },
    });

    const orderJobTypes = createArkTypeJobTypeRegistry(
      {
        "orders.place-order": {
          entry: true,
          input: type({ userId: "string" }),
          continueWith: type({ typeName: "'orders.confirm-order'" }),
        },
        "orders.confirm-order": {
          input: type({ orderId: "number" }),
          output: type({ confirmedAt: "string" }),
          blockers: type({ typeName: "'notifications.send-notification'" }).array(),
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
