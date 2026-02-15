import { type TestAPI } from "vitest";
import {
  JobTypeValidationError,
  createClient,
  createInProcessWorker,
  createJobTypeRegistry,
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

const createTestSchemaRegistry = <T>(schemas: Record<string, TestJobTypeSchema>) =>
  createJobTypeRegistry<T>({
    validateEntry: (typeName) => {
      const schema = schemas[typeName];
      if (!schema) throw new Error(`Unknown job type: "${typeName}"`);
      if (!schema.entry) throw new Error(`"${typeName}" is not an entry point`);
    },
    parseInput: (typeName, input) => {
      const schema = schemas[typeName];
      if (!schema) throw new Error(`Unknown job type: "${typeName}"`);
      validateFields(schema.input, input, "input");
      return input;
    },
    parseOutput: (typeName, output) => {
      const schema = schemas[typeName];
      if (!schema) throw new Error(`Unknown job type: "${typeName}"`);
      if (!schema.output) throw new Error(`"${typeName}" has no output schema`);
      validateFields(schema.output, output, "output");
      return output;
    },
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

const simpleRegistry = createTestSchemaRegistry<{
  main: { entry: true; input: { value: number }; output: { result: number } };
}>({
  main: { entry: true, input: { value: "number" }, output: { result: "number" } },
});

const continuationRegistry = createTestSchemaRegistry<{
  step1: { entry: true; input: { value: number }; continueWith: { typeName: "step2" } };
  step2: { input: { data: number }; output: { result: number } };
}>({
  step1: { entry: true, input: { value: "number" }, continueWith: ["step2"] },
  step2: { input: { data: "number" }, output: { result: "number" } },
});

const continuationNoFollowUpRegistry = createTestSchemaRegistry<{
  step1: { entry: true; input: { value: number }; continueWith: { typeName: "step2" } };
  step2: { input: { data: number }; output: { result: number } };
}>({
  step1: { entry: true, input: { value: "number" } },
  step2: { input: { data: "number" }, output: { result: "number" } },
});

const blockerRegistry = createTestSchemaRegistry<{
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
  it("accepts valid input at chain start", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: simpleRegistry,
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    expect(jobChain.status).toBe("pending");
    expect(jobChain.input).toEqual({ value: 42 });
  });

  it("rejects non-entry type at chain start", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: simpleRegistry,
    });

    await expect(
      client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
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
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: simpleRegistry,
    });

    await expect(
      client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.startJobChain({
            ...txContext,
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
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: blockerRegistry,
    });

    await expect(
      client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          // @ts-expect-error testing runtime validation - no blockers
          client.startJobChain({
            ...txContext,
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
    runInTransaction,
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
      registry: simpleRegistry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: simpleRegistry,
      concurrency: 1,
      processors: {
        main: {
          attemptHandler: async ({ complete }) => complete(async () => ({ result: 84 })),
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 84 });
    });
  });

  it("rejects invalid output during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
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
      registry: simpleRegistry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: simpleRegistry,
      concurrency: 1,
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
    });

    await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
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
    runInTransaction,
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
      registry: continuationRegistry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: continuationRegistry,
      concurrency: 1,
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
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "step1",
          input: { value: 1 },
        }),
      ),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.waitForJobChainCompletion(jobChain, completionOptions);
      expect(completed.output).toEqual({ result: 42 });
    });
  });

  it("rejects invalid continueWith during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
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
      registry: continuationNoFollowUpRegistry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: continuationNoFollowUpRegistry,
      concurrency: 1,
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
    });

    await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
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
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: simpleRegistry,
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    const completedChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "main",
          id: jobChain.id,
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
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: simpleRegistry,
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "main",
          input: { value: 42 },
        }),
      ),
    );

    await expect(
      client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.completeJobChain({
            ...txContext,
            typeName: "main",
            id: jobChain.id,
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
    runInTransaction,
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
      registry: continuationRegistry,
    });
    const worker = await createInProcessWorker({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: continuationRegistry,
      concurrency: 1,
      processors: {
        step2: {
          attemptHandler: async ({ complete }) => complete(async () => ({ result: 42 })),
        },
      },
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "step1",
          input: { value: 1 },
        }),
      ),
    );

    const partialChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.completeJobChain({
          ...txContext,
          typeName: "step1",
          id: jobChain.id,
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
      const completed = await client.waitForJobChainCompletion(partialChain, completionOptions);
      expect(completed.output).toEqual({ result: 42 });
    });
  });

  it("rejects invalid continueWith during workerless completion", async ({
    stateAdapter,
    notifyAdapter,
    runInTransaction,
    observabilityAdapter,
    log,
    expect,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      registry: continuationNoFollowUpRegistry,
    });

    const jobChain = await client.withNotify(async () =>
      runInTransaction(async (txContext) =>
        client.startJobChain({
          ...txContext,
          typeName: "step1",
          input: { value: 1 },
        }),
      ),
    );

    await expect(
      client.withNotify(async () =>
        runInTransaction(async (txContext) =>
          client.completeJobChain({
            ...txContext,
            typeName: "step1",
            id: jobChain.id,
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
