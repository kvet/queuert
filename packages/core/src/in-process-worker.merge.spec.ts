import { describe, expect, expectTypeOf, it } from "vitest";

import { createClient } from "./client.js";
import { defineJobTypes } from "./entities/define-job-types.js";
import { type JobTypeDefinitions } from "./entities/job-types.js";
import { type JobTypeProperty } from "./entities/job-types.resolvers.js";
import { mergeJobTypes } from "./entities/merge-job-types.js";
import { DuplicateJobTypeError } from "./errors.js";
import { createInProcessWorker } from "./in-process-worker.js";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.js";
import { withTransactionHooks } from "./transaction-hooks.js";
import { createProcessors } from "./worker/create-processors.js";
import { mergeProcessors } from "./worker/merge-processors.js";
import { type ProcessorDefinitions, processorsDefinitionsSymbol } from "./worker/processors.js";

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

const orderJobTypes = defineJobTypes<OrderDefs>();
const notificationJobTypes = defineJobTypes<NotificationDefs>();
const billingJobTypes = defineJobTypes<BillingDefs>();

const stateAdapter = await createInProcessStateAdapter();
const client = await createClient({
  stateAdapter,
  jobTypes: mergeJobTypes([orderJobTypes, notificationJobTypes, billingJobTypes]),
});

const orderProcessors = createProcessors({
  client,
  jobTypes: orderJobTypes,
  processors: {
    "orders.create": {
      attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
    },
    "orders.fulfill": {
      attemptHandler: async ({ complete }) => complete(async () => ({ fulfilled: true })),
    },
  },
});

const notificationProcessors = createProcessors({
  client,
  jobTypes: notificationJobTypes,
  processors: {
    "notifications.send": {
      attemptHandler: async ({ complete }) => complete(async () => ({ sent: true })),
    },
  },
});

describe("createProcessors", () => {
  it("accepts merged client for a slice registry", () => {
    createProcessors({
      client,
      jobTypes: orderJobTypes,
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
      jobTypes: orderJobTypes,
    });

    createProcessors({
      // @ts-expect-error — client is missing "billing.charge" from the slice's job types
      client: orderOnlyClient,
      jobTypes: billingJobTypes,
      processors: {
        "billing.charge": {
          attemptHandler: async ({ complete }: any) => complete(async () => ({ charged: true })),
        },
      },
    });
  });

  it("rejects unknown keys at compile time", () => {
    createProcessors({
      client,
      jobTypes: orderJobTypes,
      processors: {
        // @ts-expect-error — "orders.craete" is not a key of the client's defs
        "orders.craete": {
          attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
        },
      },
    });
  });

  it("rejects a mix of valid and unknown keys at compile time", () => {
    createProcessors({
      client,
      jobTypes: orderJobTypes,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
        },
        // @ts-expect-error — "orders.unknown" is not a key of the client's defs
        "orders.unknown": {
          attemptHandler: async ({ complete }: any) => complete(async () => ({})),
        },
      },
    });
  });

  it("allows partial subsets of definitions", () => {
    const processors = createProcessors({
      client,
      jobTypes: orderJobTypes,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
        },
      },
    });
    expect(processors).toHaveProperty("orders.create");
    expect(processors).not.toHaveProperty("orders.fulfill");
  });

  it("carries definitions via symbols", () => {
    expectTypeOf<ProcessorDefinitions<typeof orderProcessors>>().toEqualTypeOf<OrderDefs>();
  });

  it("sets symbols at runtime", () => {
    expect(processorsDefinitionsSymbol in orderProcessors).toBe(true);
  });

  it("includes processor handlers accessible by key", () => {
    const handler = async ({ complete }: any) => complete(async () => ({ orderId: "1" }));
    const jobTypes = createProcessors({
      client,
      jobTypes: orderJobTypes,
      processors: {
        "orders.create": { attemptHandler: handler },
      },
    });
    expect(jobTypes["orders.create"].attemptHandler).toBe(handler);
    expect(jobTypes["orders.fulfill"]).toBeUndefined();
  });

  it("does not mutate the input processors object", () => {
    const processors = {
      "orders.create": {
        attemptHandler: async ({ complete }: any) => complete(async () => ({ orderId: "1" })),
      },
    };
    const keysBefore = Object.keys(processors);
    createProcessors({
      client,
      jobTypes: orderJobTypes,
      processors,
    });
    expect(Object.keys(processors)).toEqual(keysBefore);
    expect(processorsDefinitionsSymbol in processors).toBe(false);
  });
});

describe("mergeProcessors", () => {
  it("merges two processor slices into a single object", () => {
    const merged = mergeProcessors([orderProcessors, notificationProcessors]);

    expect(merged).toHaveProperty("orders.create");
    expect(merged).toHaveProperty("orders.fulfill");
    expect(merged).toHaveProperty("notifications.send");
  });

  it("merges three processor slices", () => {
    const billingProcessors = createProcessors({
      client,
      jobTypes: billingJobTypes,
      processors: {
        "billing.charge": {
          attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
        },
      },
    });

    const merged = mergeProcessors([orderProcessors, notificationProcessors, billingProcessors]);

    expect(merged).toHaveProperty("orders.create");
    expect(merged).toHaveProperty("notifications.send");
    expect(merged).toHaveProperty("billing.charge");
  });

  it("preserves handler references", () => {
    const merged = mergeProcessors([orderProcessors, notificationProcessors]);

    expect(merged["orders.create"]).toBe(orderProcessors["orders.create"]);
    expect(merged["notifications.send"]).toBe(notificationProcessors["notifications.send"]);
  });

  it("merged result carries definitions via symbols", () => {
    const merged = mergeProcessors([orderProcessors, notificationProcessors]);

    expectTypeOf<OrderDefs>().toExtend<ProcessorDefinitions<typeof merged>>();
    expectTypeOf<NotificationDefs>().toExtend<ProcessorDefinitions<typeof merged>>();
  });

  it("merged result sets symbols at runtime", () => {
    const merged = mergeProcessors([orderProcessors, notificationProcessors]);

    expect(processorsDefinitionsSymbol in merged).toBe(true);
  });

  it("throws DuplicateJobTypeError for duplicate keys at runtime", () => {
    const altOrderProcessors = createProcessors({
      client,
      jobTypes: orderJobTypes,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
        },
      },
    });

    expect(() => {
      // @ts-expect-error — also detected at compile time
      mergeProcessors([orderProcessors, altOrderProcessors]);
    }).toThrow(DuplicateJobTypeError);
  });

  it("merges registries where one has a single processor key", () => {
    const singleKeyProcessors = createProcessors({
      client,
      jobTypes: orderJobTypes,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
        },
      },
    });

    const merged = mergeProcessors([singleKeyProcessors, notificationProcessors]);

    expect(merged).toHaveProperty("orders.create");
    expect(merged).not.toHaveProperty("orders.fulfill");
    expect(merged).toHaveProperty("notifications.send");
  });

  it("includes duplicate keys in the error", () => {
    expect.assertions(2);

    const altOrderProcessors = createProcessors({
      client,
      jobTypes: orderJobTypes,
      processors: {
        "orders.create": {
          attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
        },
      },
    });

    try {
      // @ts-expect-error — also detected at compile time
      mergeProcessors([orderProcessors, altOrderProcessors]);
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateJobTypeError);
      expect((error as DuplicateJobTypeError).duplicateTypeNames).toEqual(["orders.create"]);
    }
  });
});

describe("cross-slice blocker type resolution", () => {
  it("resolves blocker output type from external slice (tuple blockers)", async () => {
    const notifJobTypes = defineJobTypes<{
      "notif.send": {
        entry: true;
        input: { userId: string; message: string };
        output: { sentAt: string };
      };
    }>();

    const orderJobTypes = defineJobTypes<
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
      JobTypeDefinitions<typeof notifJobTypes>
    >();

    const mergedJobTypes = mergeJobTypes([notifJobTypes, orderJobTypes]);
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: mergedJobTypes });

    const notifProcessors = createProcessors({
      client,
      jobTypes: notifJobTypes,
      processors: {
        "notif.send": {
          attemptHandler: async ({ complete }) => complete(async () => ({ sentAt: "now" })),
        },
      },
    });

    const orderProcessors = createProcessors({
      client,
      jobTypes: orderJobTypes,
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

    const mergedProcessors = mergeProcessors([notifProcessors, orderProcessors]);
    expect(mergedProcessors).toHaveProperty("notif.send");
    expect(mergedProcessors).toHaveProperty("orders.place");
    expect(mergedProcessors).toHaveProperty("orders.confirm");
  });

  it("resolves blocker output type from external slice (array blockers)", async () => {
    const notifJobTypes = defineJobTypes<{
      "notif.send": {
        entry: true;
        input: { userId: string; message: string };
        output: { sentAt: string };
      };
    }>();

    const orderJobTypes = defineJobTypes<
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
      JobTypeDefinitions<typeof notifJobTypes>
    >();

    const mergedJobTypes = mergeJobTypes([notifJobTypes, orderJobTypes]);
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: mergedJobTypes });

    createProcessors({
      client,
      jobTypes: orderJobTypes,
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

  it("resolves blocker output type from multi-slice external (tuple blockers)", async () => {
    const extAJobTypes = defineJobTypes<{
      "ext-a.task": {
        entry: true;
        input: { aId: string };
        output: { aResult: string };
      };
    }>();

    const extBJobTypes = defineJobTypes<{
      "ext-b.task": {
        entry: true;
        input: { bId: string };
        output: { bResult: number };
      };
    }>();

    const localJobTypes = defineJobTypes<
      {
        "local.start": {
          entry: true;
          input: { id: string };
          continueWith: { typeName: "local.finish" };
        };
        "local.finish": {
          input: { id: string };
          output: { done: boolean };
          blockers: [{ typeName: "ext-a.task" }];
        };
      },
      JobTypeDefinitions<typeof extAJobTypes> | JobTypeDefinitions<typeof extBJobTypes>
    >();

    const mergedJobTypes = mergeJobTypes([extAJobTypes, extBJobTypes, localJobTypes]);
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: mergedJobTypes });

    createProcessors({
      client,
      jobTypes: localJobTypes,
      processors: {
        "local.finish": {
          attemptHandler: async ({ job, complete }) => {
            expectTypeOf(job.blockers[0].output).toEqualTypeOf<{ aResult: string }>();
            return complete(async () => ({ done: true }));
          },
        },
      },
    });
  });

  it("resolves blocker output type from multi-slice external (array blockers)", async () => {
    const extAJobTypes = defineJobTypes<{
      "ext-a.task": {
        entry: true;
        input: { aId: string };
        output: { aResult: string };
      };
    }>();

    const extBJobTypes = defineJobTypes<{
      "ext-b.task": {
        entry: true;
        input: { bId: string };
        output: { bResult: number };
      };
    }>();

    const localJobTypes = defineJobTypes<
      {
        "local.start": {
          entry: true;
          input: { id: string };
          continueWith: { typeName: "local.finish" };
        };
        "local.finish": {
          input: { id: string };
          output: { done: boolean };
          blockers: { typeName: "ext-a.task" }[];
        };
      },
      JobTypeDefinitions<typeof extAJobTypes> | JobTypeDefinitions<typeof extBJobTypes>
    >();

    const mergedJobTypes = mergeJobTypes([extAJobTypes, extBJobTypes, localJobTypes]);
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: mergedJobTypes });

    createProcessors({
      client,
      jobTypes: localJobTypes,
      processors: {
        "local.finish": {
          attemptHandler: async ({ job, complete }) => {
            expectTypeOf(job.blockers[0].output).toEqualTypeOf<{ aResult: string }>();
            return complete(async () => ({ done: true }));
          },
        },
      },
    });
  });

  it("resolves blocker output types referencing different external slices", async () => {
    const extAJobTypes = defineJobTypes<{
      "ext-a.task": {
        entry: true;
        input: { aId: string };
        output: { aResult: string };
      };
    }>();

    const extBJobTypes = defineJobTypes<{
      "ext-b.task": {
        entry: true;
        input: { bId: string };
        output: { bResult: number };
      };
    }>();

    const localJobTypes = defineJobTypes<
      {
        "local.start-a": {
          entry: true;
          input: { id: string };
          continueWith: { typeName: "local.finish-a" };
        };
        "local.finish-a": {
          input: { id: string };
          output: { resultA: string };
          blockers: [{ typeName: "ext-a.task" }];
        };
        "local.start-b": {
          entry: true;
          input: { id: string };
          continueWith: { typeName: "local.finish-b" };
        };
        "local.finish-b": {
          input: { id: string };
          output: { resultB: string };
          blockers: [{ typeName: "ext-b.task" }];
        };
      },
      JobTypeDefinitions<typeof extAJobTypes> | JobTypeDefinitions<typeof extBJobTypes>
    >();

    const mergedJobTypes = mergeJobTypes([extAJobTypes, extBJobTypes, localJobTypes]);
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: mergedJobTypes });

    createProcessors({
      client,
      jobTypes: localJobTypes,
      processors: {
        "local.finish-a": {
          attemptHandler: async ({ job, complete }) => {
            expectTypeOf(job.blockers[0].output).toEqualTypeOf<{ aResult: string }>();
            return complete(async () => ({ resultA: "pass" }));
          },
        },
        "local.finish-b": {
          attemptHandler: async ({ job, complete }) => {
            expectTypeOf(job.blockers[0].output).toEqualTypeOf<{ bResult: number }>();
            return complete(async () => ({ resultB: "pass" }));
          },
        },
      },
    });
  });
});

describe("cross-slice blocker type resolution in workerless completion", () => {
  it("resolves blocker types with multiple external slices", async () => {
    const extAJobTypes = defineJobTypes<{
      "ext-a.task": {
        entry: true;
        input: { aId: string };
        output: { aResult: string };
      };
    }>();

    const extBJobTypes = defineJobTypes<{
      "ext-b.task": {
        entry: true;
        input: { bId: string };
        output: { bResult: number };
      };
    }>();

    const localJobTypes = defineJobTypes<
      {
        "local.start": {
          entry: true;
          input: { id: string };
          continueWith: { typeName: "local.finish" };
        };
        "local.finish": {
          input: { id: string };
          output: { done: boolean };
          blockers: [{ typeName: "ext-a.task" }];
        };
      },
      JobTypeDefinitions<typeof extAJobTypes> | JobTypeDefinitions<typeof extBJobTypes>
    >();

    const mergedJobTypes = mergeJobTypes([extAJobTypes, extBJobTypes, localJobTypes]);
    const stateAdapter = await createInProcessStateAdapter();
    const client = await createClient({ stateAdapter, jobTypes: mergedJobTypes });

    const blockerChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "ext-a.task",
          input: { aId: "a-1" },
        }),
      ),
    );

    const chain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "local.start",
          input: { id: "1" },
        }),
      ),
    );

    await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          complete: async ({ job, complete }) => {
            if (job.typeName === "local.start") {
              return complete(job, async ({ continueWith }) =>
                continueWith({
                  typeName: "local.finish",
                  input: { id: "1" },
                  blockers: [blockerChain],
                }),
              );
            }
          },
        }),
      ),
    );
  });
});

describe("2-level merge (merge of merges)", () => {
  it("preserves processor registries through nested merges", async () => {
    const billingProcessors = createProcessors({
      client,
      jobTypes: billingJobTypes,
      processors: {
        "billing.charge": {
          attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
        },
      },
    });

    const firstMerge = mergeProcessors([orderProcessors, notificationProcessors]);
    const secondMerge = mergeProcessors([firstMerge, billingProcessors]);

    expect(secondMerge).toHaveProperty("orders.create");
    expect(secondMerge).toHaveProperty("orders.fulfill");
    expect(secondMerge).toHaveProperty("notifications.send");
    expect(secondMerge).toHaveProperty("billing.charge");

    expectTypeOf<OrderDefs>().toExtend<ProcessorDefinitions<typeof secondMerge>>();
    expectTypeOf<NotificationDefs>().toExtend<ProcessorDefinitions<typeof secondMerge>>();
    expectTypeOf<
      JobTypeProperty<ProcessorDefinitions<typeof secondMerge>, "billing.charge", "input">
    >().toEqualTypeOf<{ amount: number }>();
  });
});

describe("createInProcessWorker with partial processor registries", () => {
  it("accepts a processor jobTypes covering a single slice of the client's job types", async () => {
    const worker = await createInProcessWorker({
      client,
      processors: orderProcessors,
    });
    const stop = await worker.start();
    await stop();
  });

  it("accepts a processor jobTypes covering a different single slice", async () => {
    const worker = await createInProcessWorker({
      client,
      processors: notificationProcessors,
    });
    const stop = await worker.start();
    await stop();
  });

  it("rejects a plain object that is not a processor jobTypes", () => {
    void createInProcessWorker({
      client,
      // @ts-expect-error — plain object is not a Processors
      processors: { "orders.create": { attemptHandler: async () => {} } },
    });
  });

  it("rejects a processor jobTypes with job types unknown to the client", async () => {
    const unrelatedJobTypes = defineJobTypes<{
      "unrelated.task": { entry: true; input: { x: number }; output: { y: number } };
    }>();
    const unrelatedClient = await createClient({
      stateAdapter: await createInProcessStateAdapter(),
      jobTypes: unrelatedJobTypes,
    });
    const unrelatedProcessors = createProcessors({
      client: unrelatedClient,
      jobTypes: unrelatedJobTypes,
      processors: {
        "unrelated.task": {
          attemptHandler: async ({ complete }) => complete(async () => ({ y: 1 })),
        },
      },
    });

    void createInProcessWorker({
      client,
      // @ts-expect-error — processor jobTypes contains job types not known to the client
      processors: unrelatedProcessors,
    });
  });

  it("still accepts a fully merged processor jobTypes", async () => {
    const merged = mergeProcessors([orderProcessors, notificationProcessors]);
    const worker = await createInProcessWorker({
      client,
      processors: merged,
    });
    const stop = await worker.start();
    await stop();
  });
});
