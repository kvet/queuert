import { describe, expect, expectTypeOf, it } from "vitest";
import { createClient } from "../client.js";
import { mergeJobTypeRegistries } from "../entities/merge-job-type-registries.js";
import { defineJobTypes } from "../entities/job-type.js";
import { DuplicateJobTypeError } from "../errors.js";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import {
  type ProcessorsRegistryDefinitions,
  type ProcessorsRegistryExternalDefinitions,
  defineJobTypeProcessorRegistry,
  processorsDefinitionsSymbol,
  processorsExternalDefinitionsSymbol,
} from "./job-type-processors-registry.js";
import { mergeJobTypeProcessorRegistries } from "./merge-job-type-processors.js";

type OrderDefs = {
  "orders.create": { entry: true; input: { userId: string }; output: { orderId: string } };
  "orders.fulfill": { input: { orderId: string }; output: { fulfilled: boolean } };
};

type NotificationDefs = {
  "notifications.send": { entry: true; input: { to: string }; output: { sent: boolean } };
};

const orderJobTypes = defineJobTypes<OrderDefs>();
const notificationJobTypes = defineJobTypes<NotificationDefs>();

const stateAdapter = createInProcessStateAdapter();
const client = await createClient({
  stateAdapter,
  registry: mergeJobTypeRegistries(orderJobTypes, notificationJobTypes),
});

const orderProcessorRegistry = defineJobTypeProcessorRegistry(client, orderJobTypes, {
  "orders.create": {
    attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
  },
  "orders.fulfill": {
    attemptHandler: async ({ complete }) => complete(async () => ({ fulfilled: true })),
  },
});

const notificationProcessorRegistry = defineJobTypeProcessorRegistry(client, notificationJobTypes, {
  "notifications.send": {
    attemptHandler: async ({ complete }) => complete(async () => ({ sent: true })),
  },
});

describe("defineJobTypeProcessorRegistry", () => {
  it("rejects unknown keys at compile time", () => {
    defineJobTypeProcessorRegistry(client, orderJobTypes, {
      // @ts-expect-error — "orders.craete" is not a key of OrderDefs
      "orders.craete": {
        attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
      },
    });
  });

  it("rejects a mix of valid and unknown keys at compile time", () => {
    defineJobTypeProcessorRegistry(client, orderJobTypes, {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
      },
      // @ts-expect-error — "orders.unknown" is not a key of OrderDefs
      "orders.unknown": {
        attemptHandler: async ({ complete }: any) => complete(async () => ({})),
      },
    });
  });

  it("allows partial subsets of definitions", () => {
    const processorRegistry = defineJobTypeProcessorRegistry(client, orderJobTypes, {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
      },
    });
    expect(processorRegistry).toHaveProperty("orders.create");
    expect(processorRegistry).not.toHaveProperty("orders.fulfill");
  });

  it("carries definitions via symbols", () => {
    expectTypeOf<
      ProcessorsRegistryDefinitions<typeof orderProcessorRegistry>
    >().toEqualTypeOf<OrderDefs>();
    expectTypeOf<
      ProcessorsRegistryExternalDefinitions<typeof orderProcessorRegistry>
    >().toEqualTypeOf<Record<never, never>>();
  });

  it("sets symbols at runtime", () => {
    expect(processorsDefinitionsSymbol in orderProcessorRegistry).toBe(true);
    expect(processorsExternalDefinitionsSymbol in orderProcessorRegistry).toBe(true);
  });

  it("does not mutate the input processors object", () => {
    const processors = {
      "orders.create": {
        attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
      },
    };
    const keysBefore = Object.keys(processors);
    defineJobTypeProcessorRegistry(client, orderJobTypes, processors);
    expect(Object.keys(processors)).toEqual(keysBefore);
    expect(processorsDefinitionsSymbol in processors).toBe(false);
    expect(processorsExternalDefinitionsSymbol in processors).toBe(false);
  });
});

describe("mergeJobTypeProcessorRegistries", () => {
  it("merges two processor slices into a single object", () => {
    const merged = mergeJobTypeProcessorRegistries(
      orderProcessorRegistry,
      notificationProcessorRegistry,
    );

    expect(merged).toHaveProperty("orders.create");
    expect(merged).toHaveProperty("orders.fulfill");
    expect(merged).toHaveProperty("notifications.send");
  });

  it("merges three processor slices", () => {
    const billingJobTypes = defineJobTypes<{
      "billing.charge": { entry: true; input: { amount: number }; output: { charged: boolean } };
    }>();

    const billingProcessorRegistry = defineJobTypeProcessorRegistry(client, billingJobTypes, {
      "billing.charge": {
        attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
      },
    });

    const merged = mergeJobTypeProcessorRegistries(
      orderProcessorRegistry,
      notificationProcessorRegistry,
      billingProcessorRegistry,
    );

    expect(merged).toHaveProperty("orders.create");
    expect(merged).toHaveProperty("notifications.send");
    expect(merged).toHaveProperty("billing.charge");
  });

  it("preserves handler references", () => {
    const merged = mergeJobTypeProcessorRegistries(
      orderProcessorRegistry,
      notificationProcessorRegistry,
    );

    expect(merged["orders.create"]).toBe(orderProcessorRegistry["orders.create"]);
    expect(merged["notifications.send"]).toBe(notificationProcessorRegistry["notifications.send"]);
  });

  it("merged result carries definitions via symbols", () => {
    const merged = mergeJobTypeProcessorRegistries(
      orderProcessorRegistry,
      notificationProcessorRegistry,
    );

    expectTypeOf<ProcessorsRegistryDefinitions<typeof merged>>().toExtend<OrderDefs>();
    expectTypeOf<ProcessorsRegistryDefinitions<typeof merged>>().toExtend<NotificationDefs>();
  });

  it("merged result sets symbols at runtime", () => {
    const merged = mergeJobTypeProcessorRegistries(
      orderProcessorRegistry,
      notificationProcessorRegistry,
    );

    expect(processorsDefinitionsSymbol in merged).toBe(true);
    expect(processorsExternalDefinitionsSymbol in merged).toBe(true);
  });

  it("throws DuplicateJobTypeError for duplicate keys at runtime", () => {
    const altOrderProcessors = defineJobTypeProcessorRegistry(client, orderJobTypes, {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
      },
    });

    expect(() => {
      mergeJobTypeProcessorRegistries(orderProcessorRegistry, altOrderProcessors);
    }).toThrow(DuplicateJobTypeError);
  });

  it("includes duplicate keys in the error", () => {
    expect.assertions(2);

    const altOrderProcessors = defineJobTypeProcessorRegistry(client, orderJobTypes, {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
      },
    });

    try {
      mergeJobTypeProcessorRegistries(orderProcessorRegistry, altOrderProcessors);
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateJobTypeError);
      expect((error as DuplicateJobTypeError).duplicateTypeNames).toEqual(["orders.create"]);
    }
  });
});
