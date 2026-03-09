import { describe, expect, expectTypeOf, it } from "vitest";
import { createClient } from "../client.js";
import { defineJobTypeRegistry } from "../entities/define-job-type-registry.js";
import { mergeJobTypeRegistries } from "../entities/merge-job-type-registries.js";
import { DuplicateJobTypeError } from "../errors.js";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { type JobTypeRegistryDefinitions } from "../entities/job-type-registry.js";
import { createJobTypeProcessorRegistry } from "./create-job-type-processor-registry.js";
import {
  type ExternalJobTypeProcessorRegistryDefinitions,
  type JobTypeProcessorRegistryDefinitions,
  processorDefinitionsSymbol,
  processorExternalDefinitionsSymbol,
} from "./job-type-processor-registry.js";
import { mergeJobTypeProcessorRegistries } from "./merge-job-type-processors.js";

type OrderDefs = {
  "orders.create": { entry: true; input: { userId: string }; output: { orderId: string } };
  "orders.fulfill": { input: { orderId: string }; output: { fulfilled: boolean } };
};

type NotificationDefs = {
  "notifications.send": { entry: true; input: { to: string }; output: { sent: boolean } };
};

const orderJobTypeRegistry = defineJobTypeRegistry<OrderDefs>();
const notificationJobTypeRegistry = defineJobTypeRegistry<NotificationDefs>();

const stateAdapter = createInProcessStateAdapter();
const client = await createClient({
  stateAdapter,
  registry: mergeJobTypeRegistries(orderJobTypeRegistry, notificationJobTypeRegistry),
});

const orderProcessorRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
  "orders.create": {
    attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
  },
  "orders.fulfill": {
    attemptHandler: async ({ complete }) => complete(async () => ({ fulfilled: true })),
  },
});

const notificationProcessorRegistry = createJobTypeProcessorRegistry(
  client,
  notificationJobTypeRegistry,
  {
    "notifications.send": {
      attemptHandler: async ({ complete }) => complete(async () => ({ sent: true })),
    },
  },
);

describe("createJobTypeProcessorRegistry", () => {
  it("rejects unknown keys at compile time", () => {
    createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
      // @ts-expect-error — "orders.craete" is not a key of OrderDefs
      "orders.craete": {
        attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
      },
    });
  });

  it("rejects a mix of valid and unknown keys at compile time", () => {
    createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
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
    const processorRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
      },
    });
    expect(processorRegistry).toHaveProperty("orders.create");
    expect(processorRegistry).not.toHaveProperty("orders.fulfill");
  });

  it("carries definitions via symbols", () => {
    expectTypeOf<
      JobTypeProcessorRegistryDefinitions<typeof orderProcessorRegistry>
    >().toEqualTypeOf<OrderDefs>();
    expectTypeOf<
      ExternalJobTypeProcessorRegistryDefinitions<typeof orderProcessorRegistry>
    >().toEqualTypeOf<Record<never, never>>();
  });

  it("sets symbols at runtime", () => {
    expect(processorDefinitionsSymbol in orderProcessorRegistry).toBe(true);
    expect(processorExternalDefinitionsSymbol in orderProcessorRegistry).toBe(true);
  });

  it("includes processor handlers accessible by key", () => {
    const handler = async ({ complete }: any) => complete(async () => ({ orderId: "1" }));
    const registry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
      "orders.create": { attemptHandler: handler },
    });
    expect(registry["orders.create"].attemptHandler).toBe(handler);
    expect(registry["orders.fulfill"]).toBeUndefined();
  });

  it("does not mutate the input processors object", () => {
    const processors = {
      "orders.create": {
        attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
      },
    };
    const keysBefore = Object.keys(processors);
    createJobTypeProcessorRegistry(client, orderJobTypeRegistry, processors);
    expect(Object.keys(processors)).toEqual(keysBefore);
    expect(processorDefinitionsSymbol in processors).toBe(false);
    expect(processorExternalDefinitionsSymbol in processors).toBe(false);
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
    const billingJobTypeRegistry = defineJobTypeRegistry<{
      "billing.charge": { entry: true; input: { amount: number }; output: { charged: boolean } };
    }>();

    const billingProcessorRegistry = createJobTypeProcessorRegistry(
      client,
      billingJobTypeRegistry,
      {
        "billing.charge": {
          attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
        },
      },
    );

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

    expectTypeOf<JobTypeProcessorRegistryDefinitions<typeof merged>>().toExtend<OrderDefs>();
    expectTypeOf<JobTypeProcessorRegistryDefinitions<typeof merged>>().toExtend<NotificationDefs>();
  });

  it("merged result sets symbols at runtime", () => {
    const merged = mergeJobTypeProcessorRegistries(
      orderProcessorRegistry,
      notificationProcessorRegistry,
    );

    expect(processorDefinitionsSymbol in merged).toBe(true);
    expect(processorExternalDefinitionsSymbol in merged).toBe(true);
  });

  it("throws DuplicateJobTypeError for duplicate keys at runtime", () => {
    const altOrderProcessorRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
      },
    });

    expect(() => {
      mergeJobTypeProcessorRegistries(orderProcessorRegistry, altOrderProcessorRegistry);
    }).toThrow(DuplicateJobTypeError);
  });

  it("merges registries where one has a single processor key", () => {
    const singleKeyRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
      },
    });

    const merged = mergeJobTypeProcessorRegistries(
      singleKeyRegistry,
      notificationProcessorRegistry,
    );

    expect(merged).toHaveProperty("orders.create");
    expect(merged).not.toHaveProperty("orders.fulfill");
    expect(merged).toHaveProperty("notifications.send");
  });

  it("includes duplicate keys in the error", () => {
    expect.assertions(2);

    const altOrderProcessorRegistry = createJobTypeProcessorRegistry(client, orderJobTypeRegistry, {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
      },
    });

    try {
      mergeJobTypeProcessorRegistries(orderProcessorRegistry, altOrderProcessorRegistry);
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateJobTypeError);
      expect((error as DuplicateJobTypeError).duplicateTypeNames).toEqual(["orders.create"]);
    }
  });
});

describe("cross-slice blocker type resolution", () => {
  it("resolves blocker output type from external slice (tuple blockers)", async () => {
    const notifTypeRegistry = defineJobTypeRegistry<{
      "notif.send": {
        entry: true;
        input: { userId: string; message: string };
        output: { sentAt: string };
      };
    }>();

    const orderTypeRegistry = defineJobTypeRegistry<
      {
        "orders.place": {
          entry: true;
          input: { userId: string };
          continueWith: { typeName: "orders.confirm" };
        };
        "orders.confirm": {
          input: { orderId: number };
          output: { confirmedAt: string };
          blockers: [{ typeName: "notif.send" }];
        };
      },
      JobTypeRegistryDefinitions<typeof notifTypeRegistry>
    >();

    const merged = mergeJobTypeRegistries(notifTypeRegistry, orderTypeRegistry);
    const sa = createInProcessStateAdapter();
    const c = await createClient({ stateAdapter: sa, registry: merged });

    const notifProcessorRegistry = createJobTypeProcessorRegistry(c, notifTypeRegistry, {
      "notif.send": {
        attemptHandler: async ({ complete }) => complete(async () => ({ sentAt: "now" })),
      },
    });

    const orderProcessorRegistry = createJobTypeProcessorRegistry(c, orderTypeRegistry, {
      "orders.place": {
        attemptHandler: async ({ complete }) =>
          complete(async ({ continueWith }) =>
            continueWith({
              typeName: "orders.confirm",
              input: { orderId: 1 },
              blockers: [] as never,
            }),
          ),
      },
      "orders.confirm": {
        attemptHandler: async ({ job, complete }) => {
          expectTypeOf(job.blockers[0].output).toEqualTypeOf<{ sentAt: string }>();
          return complete(async () => ({ confirmedAt: "now" }));
        },
      },
    });

    const mergedProcessorRegistry = mergeJobTypeProcessorRegistries(
      notifProcessorRegistry,
      orderProcessorRegistry,
    );
    expect(mergedProcessorRegistry).toHaveProperty("notif.send");
    expect(mergedProcessorRegistry).toHaveProperty("orders.place");
    expect(mergedProcessorRegistry).toHaveProperty("orders.confirm");
  });

  it("resolves blocker output type from external slice (array blockers)", async () => {
    const notifTypeRegistry = defineJobTypeRegistry<{
      "notif.send": {
        entry: true;
        input: { userId: string; message: string };
        output: { sentAt: string };
      };
    }>();

    const orderTypeRegistry = defineJobTypeRegistry<
      {
        "orders.place": {
          entry: true;
          input: { userId: string };
          continueWith: { typeName: "orders.confirm" };
        };
        "orders.confirm": {
          input: { orderId: number };
          output: { confirmedAt: string };
          blockers: { typeName: "notif.send" }[];
        };
      },
      JobTypeRegistryDefinitions<typeof notifTypeRegistry>
    >();

    const merged = mergeJobTypeRegistries(notifTypeRegistry, orderTypeRegistry);
    const sa = createInProcessStateAdapter();
    const c = await createClient({ stateAdapter: sa, registry: merged });

    createJobTypeProcessorRegistry(c, orderTypeRegistry, {
      "orders.place": {
        attemptHandler: async ({ complete }) =>
          complete(async ({ continueWith }) =>
            continueWith({
              typeName: "orders.confirm",
              input: { orderId: 1 },
              blockers: [] as never,
            }),
          ),
      },
      "orders.confirm": {
        attemptHandler: async ({ job, complete }) => {
          expectTypeOf(job.blockers[0].output).toEqualTypeOf<{ sentAt: string }>();
          return complete(async () => ({ confirmedAt: "now" }));
        },
      },
    });
  });
});

describe("2-level merge (merge of merges)", () => {
  it("preserves processor registries through nested merges", async () => {
    const billingTypeRegistry = defineJobTypeRegistry<{
      "billing.charge": { entry: true; input: { amount: number }; output: { charged: boolean } };
    }>();

    const billingProcessorRegistry = createJobTypeProcessorRegistry(client, billingTypeRegistry, {
      "billing.charge": {
        attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
      },
    });

    const firstMerge = mergeJobTypeProcessorRegistries(
      orderProcessorRegistry,
      notificationProcessorRegistry,
    );
    const secondMerge = mergeJobTypeProcessorRegistries(firstMerge, billingProcessorRegistry);

    expect(secondMerge).toHaveProperty("orders.create");
    expect(secondMerge).toHaveProperty("orders.fulfill");
    expect(secondMerge).toHaveProperty("notifications.send");
    expect(secondMerge).toHaveProperty("billing.charge");

    expectTypeOf<JobTypeProcessorRegistryDefinitions<typeof secondMerge>>().toExtend<OrderDefs>();
    expectTypeOf<
      JobTypeProcessorRegistryDefinitions<typeof secondMerge>
    >().toExtend<NotificationDefs>();
    expectTypeOf<JobTypeProcessorRegistryDefinitions<typeof secondMerge>>().toHaveProperty(
      "billing.charge",
    );
  });
});
