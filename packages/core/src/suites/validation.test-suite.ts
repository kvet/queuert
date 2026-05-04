import { type TestAPI } from "vitest";

import {
  type BaseJobTypeDefinitions,
  JobTypeValidationError,
  createClient,
  createInProcessWorker,
  createProcessors,
  createJobTypes,
  withTransactionHooks,
} from "../index.js";
import { type TestSuiteContext } from "./spec-context.spec-helper.js";

// --- Mini schema adapter (mirrors real adapter pattern) ---

type FieldType = "string" | "number" | "boolean";
type FieldSchema = Record<string, FieldType>;

type TestJobTypeSchema = {
  entry?: boolean;
  input: FieldSchema;
  output?: FieldSchema;
  continueWith?: string[];
  blockers?: { minCount: number };
};

const validateFields = (schema: FieldSchema, data: unknown, label: string): void => {
  if (typeof data !== "object" || data === null) {
    throw new Error(`${label} must be an object`);
  }
  for (const [key, expectedType] of Object.entries(schema)) {
    if (typeof (data as Record<string, unknown>)[key] !== expectedType) {
      throw new Error(
        `${label}.${key}: expected ${expectedType}, got ${typeof (data as Record<string, unknown>)[key]}`,
      );
    }
  }
};

const createTestSchemaRegistry = <T extends BaseJobTypeDefinitions>(
  schemas: Record<string, TestJobTypeSchema>,
) =>
  createJobTypes<T>({
    getTypeNames: () => Object.keys(schemas),
    validateEntry: (typeName) => {
      const schema = schemas[typeName];
      if (!schema) throw new Error(`Unknown job type: "${typeName}"`);
      if (!schema.entry) throw new Error(`"${typeName}" is not an entry point`);
    },
    encode: async (items) =>
      items.map((i) => {
        const schema = schemas[i.typeName];
        if (!schema) throw new Error(`Unknown job type: "${i.typeName}"`);
        if (i.direction === "input") {
          validateFields(schema.input, i.value, "input");
        } else {
          if (!schema.output) throw new Error(`"${i.typeName}" has no output schema`);
          validateFields(schema.output, i.value, "output");
        }
        return i.value;
      }),
    decode: async (items) =>
      items.map((i) => {
        const schema = schemas[i.typeName];
        if (!schema) throw new Error(`Unknown job type: "${i.typeName}"`);
        if (i.direction === "input") {
          validateFields(schema.input, i.value, "input");
        } else {
          if (!schema.output) throw new Error(`"${i.typeName}" has no output schema`);
          validateFields(schema.output, i.value, "output");
        }
        return i.value;
      }),
    validateContinueWith: (fromTypeName, target) => {
      const schema = schemas[fromTypeName];
      if (!schema) throw new Error(`Unknown job type: "${fromTypeName}"`);
      if (!schema.continueWith) throw new Error(`"${fromTypeName}" does not allow continuation`);
      if (!schema.continueWith.includes(target.typeName)) {
        throw new Error(`"${fromTypeName}" cannot continue to "${target.typeName}"`);
      }
    },
    validateBlockers: (typeName, blockers) => {
      const schema = schemas[typeName];
      if (!schema) throw new Error(`Unknown job type: "${typeName}"`);
      if (schema.blockers && blockers.length < schema.blockers.minCount) {
        throw new Error(
          `"${typeName}" requires at least ${schema.blockers.minCount} blocker(s), got ${blockers.length}`,
        );
      }
    },
  });

// --- Registries ---

const simpleJobTypes = createTestSchemaRegistry<{
  main: { entry: true; input: { value: number }; output: { result: number } };
}>({
  main: { entry: true, input: { value: "number" }, output: { result: "number" } },
});

const continuationJobTypes = createTestSchemaRegistry<{
  step1: { entry: true; input: { value: number }; continueWith: { typeName: "step2" } };
  step2: { input: { data: number }; output: { result: number } };
}>({
  step1: { entry: true, input: { value: "number" }, continueWith: ["step2"] },
  step2: { input: { data: "number" }, output: { result: "number" } },
});

const continuationNoFollowUpJobTypes = createTestSchemaRegistry<{
  step1: { entry: true; input: { value: number }; continueWith: { typeName: "step2" } };
  step2: { input: { data: number }; output: { result: number } };
}>({
  step1: { entry: true, input: { value: "number" } },
  step2: { input: { data: "number" }, output: { result: "number" } },
});

const blockerJobTypes = createTestSchemaRegistry<{
  main: {
    entry: true;
    input: { id: string };
    output: { done: boolean };
    blockers: [{ typeName: "auth" }];
  };
  auth: { entry: true; input: { token: string }; output: { userId: string } };
}>({
  main: {
    entry: true,
    input: { id: "string" },
    output: { done: "boolean" },
    blockers: { minCount: 1 },
  },
  auth: { entry: true, input: { token: "string" }, output: { userId: "string" } },
});

// --- Test suite ---

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

export const validationTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("getTypeNames returns registered type names", ({ expect }) => {
    expect(simpleJobTypes.getTypeNames()).toEqual(["main"]);
    expect(continuationJobTypes.getTypeNames()).toEqual(expect.arrayContaining(["step1", "step2"]));
    expect(blockerJobTypes.getTypeNames()).toEqual(expect.arrayContaining(["main", "auth"]));
  });

  it("accepts valid input at chain start", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    expect(chain.status).toBe("pending");
    expect(chain.input).toEqual({ value: 42 });
  });

  it("rejects non-entry type at chain start", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startChain({
            ...txCtx,
            transactionHooks,
            // @ts-expect-error testing runtime validation
            typeName: "nonexistent",
            input: { value: 1 },
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects invalid input at chain start", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.startChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            // @ts-expect-error testing runtime validation
            input: { value: "not-a-number" },
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects invalid blockers at chain start", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: blockerJobTypes,
    });

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          // @ts-expect-error testing runtime validation - no blockers
          client.startChain({
            ...txCtx,
            transactionHooks,
            typeName: "main",
            input: { id: "main-1" },
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("accepts valid output during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: simpleJobTypes,
        processors: {
          main: {
            attemptHandler: async ({ complete }) => complete(async () => ({ result: 84 })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 84 });
    });
  });

  it("rejects invalid output during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const validationFailed = Promise.withResolvers<unknown>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: simpleJobTypes,
        processors: {
          main: {
            attemptHandler: async ({ complete }) => {
              try {
                // @ts-expect-error testing runtime validation
                return await complete(async () => ({ result: "not-a-number" }));
              } catch (error) {
                validationFailed.resolve(error);
                throw error;
              }
            },
          },
        },
      }),
    });

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const error = await validationFailed.promise;
      expect(error).toBeInstanceOf(JobTypeValidationError);
    });
  });

  it("accepts valid continueWith during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationJobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: continuationJobTypes,
        processors: {
          step1: {
            attemptHandler: async ({ complete }) =>
              complete(async ({ continueWith }) =>
                continueWith({ typeName: "step2", input: { data: 1 } }),
              ),
          },
          step2: {
            attemptHandler: async ({ complete }) => complete(async () => ({ result: 42 })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 42 });
    });
  });

  it("rejects invalid continueWith during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const validationFailed = Promise.withResolvers<unknown>();

    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationNoFollowUpJobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: continuationNoFollowUpJobTypes,
        processors: {
          step1: {
            attemptHandler: async ({ complete }) => {
              try {
                return await complete(async ({ continueWith }) =>
                  continueWith({ typeName: "step2", input: { data: 1 } }),
                );
              } catch (error) {
                validationFailed.resolve(error);
                throw error;
              }
            },
          },
          step2: {
            attemptHandler: async ({ complete }) => complete(async () => ({ result: 1 })),
          },
        },
      }),
    });

    await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const error = await validationFailed.promise;
      expect(error).toBeInstanceOf(JobTypeValidationError);
    });
  });

  it("accepts valid output during workerless completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    const completedChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          complete: async ({ job, complete }) => complete(job, async () => ({ result: 84 })),
        }),
      ),
    );

    expect(completedChain.status).toBe("completed");
    expect(completedChain.output).toEqual({ result: 84 });
  });

  it("rejects invalid output during workerless completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            ...chain,
            complete: async ({ job, complete }) =>
              // @ts-expect-error testing runtime validation
              complete(job, async () => ({ result: "not-a-number" })),
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("accepts valid continueWith during workerless completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationJobTypes,
    });
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: continuationJobTypes,
        processors: {
          step2: {
            attemptHandler: async ({ complete }) => complete(async () => ({ result: 42 })),
          },
        },
      }),
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 1 },
        }),
      ),
    );

    const partialChain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          complete: async ({ job, complete }) => {
            if (job.typeName === "step1") {
              await complete(job, async ({ continueWith }) =>
                continueWith({ typeName: "step2", input: { data: 1 } }),
              );
            }
          },
        }),
      ),
    );

    expect(partialChain.status).toBe("pending");

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(partialChain, completionOptions);
      expect(completed.output).toEqual({ result: 42 });
    });
  });

  it("rejects invalid continueWith during workerless completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationNoFollowUpJobTypes,
    });

    const chain = await withTransactionHooks(async (transactionHooks) =>
      withTransaction(async (txCtx) =>
        client.startChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          input: { value: 1 },
        }),
      ),
    );

    await expect(
      withTransactionHooks(async (transactionHooks) =>
        withTransaction(async (txCtx) =>
          client.completeChain({
            ...txCtx,
            transactionHooks,
            typeName: "step1",
            id: chain.id,
            complete: async ({ job, complete }) => {
              if (job.typeName === "step1") {
                await complete(job, async ({ continueWith }) =>
                  continueWith({ typeName: "step2", input: { data: 1 } }),
                );
              }
            },
          }),
        ),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });
};
