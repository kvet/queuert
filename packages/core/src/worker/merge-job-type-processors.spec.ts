import { describe, expect, expectTypeOf, it } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypeRegistry } from "../entities/define-job-type-registry.js";
import { type JobTypeRegistryDefinitions } from "../entities/job-type-registry.js";
import { type JobTypeProperty } from "../entities/job-type-registry.resolvers.js";
import { mergeJobTypeRegistries } from "../entities/merge-job-type-registries.js";
import { DuplicateJobTypeError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
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

type BillingDefs = {
  "billing.charge": { entry: true; input: { amount: number }; output: { charged: boolean } };
};

const orderJobTypeRegistry = defineJobTypeRegistry<OrderDefs>();
const notificationJobTypeRegistry = defineJobTypeRegistry<NotificationDefs>();
const billingJobTypeRegistry = defineJobTypeRegistry<BillingDefs>();

const stateAdapter = createInProcessStateAdapter();
const client = await createClient({
  stateAdapter,
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [orderJobTypeRegistry, notificationJobTypeRegistry, billingJobTypeRegistry],
  }),
});

const orderJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
  client,
  jobTypeRegistry: orderJobTypeRegistry,
  processors: {
    "orders.create": {
      attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
    },
    "orders.fulfill": {
      attemptHandler: async ({ complete }) => complete(async () => ({ fulfilled: true })),
    },
  },
});

const notificationJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
  client,
  jobTypeRegistry: notificationJobTypeRegistry,
  processors: {
    "notifications.send": {
      attemptHandler: async ({ complete }) => complete(async () => ({ sent: true })),
    },
  },
});

describe("createJobTypeProcessorRegistry", () => {
  it("accepts merged client for a slice registry", () => {
    createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
        },
      },
    });
  });

  it("rejects client missing required job types", async () => {
    const orderOnlyClient = await createClient({
      stateAdapter,
      jobTypeRegistry: orderJobTypeRegistry,
    });

    createJobTypeProcessorRegistry({
      // @ts-expect-error — client does not include BillingDefs
      client: orderOnlyClient,
      jobTypeRegistry: billingJobTypeRegistry,
      processors: {
        "billing.charge": {
          attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
        },
      },
    });
  });

  it("rejects unknown keys at compile time", () => {
    createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
        // @ts-expect-error — "orders.craete" is not a key of OrderDefs
        "orders.craete": {
          attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
        },
      },
    });
  });

  it("rejects a mix of valid and unknown keys at compile time", () => {
    createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
        },
        // @ts-expect-error — "orders.unknown" is not a key of OrderDefs
        "orders.unknown": {
          attemptHandler: async ({ complete }: any) => complete(async () => ({})),
        },
      },
    });
  });

  it("allows partial subsets of definitions", () => {
    const jobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
        },
      },
    });
    expect(jobTypeProcessorRegistry).toHaveProperty("orders.create");
    expect(jobTypeProcessorRegistry).not.toHaveProperty("orders.fulfill");
  });

  it("carries definitions via symbols", () => {
    expectTypeOf<
      JobTypeProcessorRegistryDefinitions<typeof orderJobTypeProcessorRegistry>
    >().toEqualTypeOf<OrderDefs>();
    expectTypeOf<
      ExternalJobTypeProcessorRegistryDefinitions<typeof orderJobTypeProcessorRegistry>
    >().toEqualTypeOf<Record<never, never>>();
  });

  it("sets symbols at runtime", () => {
    expect(processorDefinitionsSymbol in orderJobTypeProcessorRegistry).toBe(true);
    expect(processorExternalDefinitionsSymbol in orderJobTypeProcessorRegistry).toBe(true);
  });

  it("includes processor handlers accessible by key", () => {
    const handler = async ({ complete }: any) => complete(async () => ({ orderId: "1" }));
    const jobTypeRegistry = createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
        "orders.create": { attemptHandler: handler },
      },
    });
    expect(jobTypeRegistry["orders.create"].attemptHandler).toBe(handler);
    expect(jobTypeRegistry["orders.fulfill"]).toBeUndefined();
  });

  it("rejects a merged jobTypeRegistry at compile time", () => {
    const mergedJobTypeRegistry = mergeJobTypeRegistries({
      slices: [orderJobTypeRegistry, notificationJobTypeRegistry],
    });

    const _fn = () =>
      createJobTypeProcessorRegistry({
        client,
        // @ts-expect-error — merged registries cannot be passed to createJobTypeProcessorRegistry
        jobTypeRegistry: mergedJobTypeRegistry,
        processors: {},
      });
  });

  it("rejects a merged jobTypeRegistry at runtime", () => {
    const mergedJobTypeRegistry = mergeJobTypeRegistries({
      slices: [orderJobTypeRegistry, notificationJobTypeRegistry],
    });

    expect(() => {
      createJobTypeProcessorRegistry({
        client,
        // @ts-expect-error — merged registries cannot be passed to createJobTypeProcessorRegistry
        jobTypeRegistry: mergedJobTypeRegistry,
        processors: {
          "orders.create": {
            attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
          },
        },
      });
    }).toThrow(TypeError);
  });

  it("does not mutate the input processors object", () => {
    const processors = {
      "orders.create": {
        attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
      },
    };
    const keysBefore = Object.keys(processors);
    createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: processors,
    });
    expect(Object.keys(processors)).toEqual(keysBefore);
    expect(processorDefinitionsSymbol in processors).toBe(false);
    expect(processorExternalDefinitionsSymbol in processors).toBe(false);
  });
});

describe("mergeJobTypeProcessorRegistries", () => {
  it("merges two processor slices into a single object", () => {
    const merged = mergeJobTypeProcessorRegistries({
      slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
    });

    expect(merged).toHaveProperty("orders.create");
    expect(merged).toHaveProperty("orders.fulfill");
    expect(merged).toHaveProperty("notifications.send");
  });

  it("merges three processor slices", () => {
    const billingJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: billingJobTypeRegistry,
      processors: {
        "billing.charge": {
          attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
        },
      },
    });

    const merged = mergeJobTypeProcessorRegistries({
      slices: [
        orderJobTypeProcessorRegistry,
        notificationJobTypeProcessorRegistry,
        billingJobTypeProcessorRegistry,
      ],
    });

    expect(merged).toHaveProperty("orders.create");
    expect(merged).toHaveProperty("notifications.send");
    expect(merged).toHaveProperty("billing.charge");
  });

  it("preserves handler references", () => {
    const merged = mergeJobTypeProcessorRegistries({
      slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
    });

    expect(merged["orders.create"]).toBe(orderJobTypeProcessorRegistry["orders.create"]);
    expect(merged["notifications.send"]).toBe(
      notificationJobTypeProcessorRegistry["notifications.send"],
    );
  });

  it("merged result carries definitions via symbols", () => {
    const merged = mergeJobTypeProcessorRegistries({
      slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
    });

    expectTypeOf<OrderDefs>().toExtend<JobTypeProcessorRegistryDefinitions<typeof merged>>();
    expectTypeOf<NotificationDefs>().toExtend<JobTypeProcessorRegistryDefinitions<typeof merged>>();
  });

  it("merged result sets symbols at runtime", () => {
    const merged = mergeJobTypeProcessorRegistries({
      slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
    });

    expect(processorDefinitionsSymbol in merged).toBe(true);
    expect(processorExternalDefinitionsSymbol in merged).toBe(true);
  });

  it("throws DuplicateJobTypeError for duplicate keys at runtime", () => {
    const altOrderJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
        },
      },
    });

    expect(() => {
      mergeJobTypeProcessorRegistries({
        slices: [orderJobTypeProcessorRegistry, altOrderJobTypeProcessorRegistry],
      });
    }).toThrow(DuplicateJobTypeError);
  });

  it("merges registries where one has a single processor key", () => {
    const singleKeyJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
        },
      },
    });

    const merged = mergeJobTypeProcessorRegistries({
      slices: [singleKeyJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
    });

    expect(merged).toHaveProperty("orders.create");
    expect(merged).not.toHaveProperty("orders.fulfill");
    expect(merged).toHaveProperty("notifications.send");
  });

  it("includes duplicate keys in the error", () => {
    expect.assertions(2);

    const altOrderJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
        },
      },
    });

    try {
      mergeJobTypeProcessorRegistries({
        slices: [orderJobTypeProcessorRegistry, altOrderJobTypeProcessorRegistry],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateJobTypeError);
      expect((error as DuplicateJobTypeError).duplicateTypeNames).toEqual(["orders.create"]);
    }
  });
});

describe("cross-slice blocker type resolution", () => {
  it("resolves blocker output type from external slice (tuple blockers)", async () => {
    const notifJobTypeRegistry = defineJobTypeRegistry<{
      "notif.send": {
        entry: true;
        input: { userId: string; message: string };
        output: { sentAt: string };
      };
    }>();

    const orderJobTypeRegistry = defineJobTypeRegistry<
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
      JobTypeRegistryDefinitions<typeof notifJobTypeRegistry>
    >();

    const mergedJobTypeRegistry = mergeJobTypeRegistries({
      slices: [notifJobTypeRegistry, orderJobTypeRegistry],
    });
    const sa = createInProcessStateAdapter();
    const c = await createClient({ stateAdapter: sa, jobTypeRegistry: mergedJobTypeRegistry });

    const notifJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client: c,
      jobTypeRegistry: notifJobTypeRegistry,
      processors: {
        "notif.send": {
          attemptHandler: async ({ complete }) => complete(async () => ({ sentAt: "now" })),
        },
      },
    });

    const orderJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client: c,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
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
      },
    });

    const mergedJobTypeProcessorRegistry = mergeJobTypeProcessorRegistries({
      slices: [notifJobTypeProcessorRegistry, orderJobTypeProcessorRegistry],
    });
    expect(mergedJobTypeProcessorRegistry).toHaveProperty("notif.send");
    expect(mergedJobTypeProcessorRegistry).toHaveProperty("orders.place");
    expect(mergedJobTypeProcessorRegistry).toHaveProperty("orders.confirm");
  });

  it("resolves blocker output type from external slice (array blockers)", async () => {
    const notifJobTypeRegistry = defineJobTypeRegistry<{
      "notif.send": {
        entry: true;
        input: { userId: string; message: string };
        output: { sentAt: string };
      };
    }>();

    const orderJobTypeRegistry = defineJobTypeRegistry<
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
      JobTypeRegistryDefinitions<typeof notifJobTypeRegistry>
    >();

    const mergedJobTypeRegistry = mergeJobTypeRegistries({
      slices: [notifJobTypeRegistry, orderJobTypeRegistry],
    });
    const sa = createInProcessStateAdapter();
    const c = await createClient({ stateAdapter: sa, jobTypeRegistry: mergedJobTypeRegistry });

    createJobTypeProcessorRegistry({
      client: c,
      jobTypeRegistry: orderJobTypeRegistry,
      processors: {
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
      },
    });
  });
});

describe("2-level merge (merge of merges)", () => {
  it("preserves processor registries through nested merges", async () => {
    const billingJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client,
      jobTypeRegistry: billingJobTypeRegistry,
      processors: {
        "billing.charge": {
          attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
        },
      },
    });

    const firstMerge = mergeJobTypeProcessorRegistries({
      slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
    });
    const secondMerge = mergeJobTypeProcessorRegistries({
      slices: [firstMerge, billingJobTypeProcessorRegistry],
    });

    expect(secondMerge).toHaveProperty("orders.create");
    expect(secondMerge).toHaveProperty("orders.fulfill");
    expect(secondMerge).toHaveProperty("notifications.send");
    expect(secondMerge).toHaveProperty("billing.charge");

    expectTypeOf<OrderDefs>().toExtend<JobTypeProcessorRegistryDefinitions<typeof secondMerge>>();
    expectTypeOf<NotificationDefs>().toExtend<
      JobTypeProcessorRegistryDefinitions<typeof secondMerge>
    >();
    expectTypeOf<
      JobTypeProperty<
        JobTypeProcessorRegistryDefinitions<typeof secondMerge>,
        "billing.charge",
        "input"
      >
    >().toEqualTypeOf<{ amount: number }>();
  });
});

describe("createInProcessWorker with partial processor registries", () => {
  it("accepts a processor jobTypeRegistry covering a single slice of the client's job types", async () => {
    const worker = await createInProcessWorker({
      client,
      jobTypeProcessorRegistry: orderJobTypeProcessorRegistry,
    });
    const stop = await worker.start();
    await stop();
  });

  it("accepts a processor jobTypeRegistry covering a different single slice", async () => {
    const worker = await createInProcessWorker({
      client,
      jobTypeProcessorRegistry: notificationJobTypeProcessorRegistry,
    });
    const stop = await worker.start();
    await stop();
  });

  it("rejects a plain object that is not a processor jobTypeRegistry", () => {
    void createInProcessWorker({
      client,
      // @ts-expect-error — plain object is not a JobTypeProcessorRegistry
      jobTypeProcessorRegistry: { "orders.create": { attemptHandler: async () => {} } },
    });
  });

  it("rejects a processor jobTypeRegistry with job types unknown to the client", async () => {
    const unrelatedJobTypeRegistry = defineJobTypeRegistry<{
      "unrelated.task": { entry: true; input: { x: number }; output: { y: number } };
    }>();
    const unrelatedClient = await createClient({
      stateAdapter: createInProcessStateAdapter(),
      jobTypeRegistry: unrelatedJobTypeRegistry,
    });
    const unrelatedJobTypeProcessorRegistry = createJobTypeProcessorRegistry({
      client: unrelatedClient,
      jobTypeRegistry: unrelatedJobTypeRegistry,
      processors: {
        "unrelated.task": {
          attemptHandler: async ({ complete }) => complete(async () => ({ y: 1 })),
        },
      },
    });

    void createInProcessWorker({
      client,
      // @ts-expect-error — processor jobTypeRegistry contains job types not known to the client
      jobTypeProcessorRegistry: unrelatedJobTypeProcessorRegistry,
    });
  });

  it("still accepts a fully merged processor jobTypeRegistry", async () => {
    const merged = mergeJobTypeProcessorRegistries({
      slices: [orderJobTypeProcessorRegistry, notificationJobTypeProcessorRegistry],
    });
    const worker = await createInProcessWorker({
      client,
      jobTypeProcessorRegistry: merged,
    });
    const stop = await worker.start();
    await stop();
  });
});
