import { type TestAPI, assert, expect } from "vitest";

import { createClient } from "../client.js";
import { JobTypeValidationError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { createProcessors } from "../job-type-processors/create-job-type-processors.js";
import {
  type BaseJobTypeDefinitions,
  type ResolvedJobTypeReference,
} from "../job-types/job-type.js";
import { createJobTypes } from "../job-types/job-types.js";
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
) => {
  const schemaFor = (typeName: string) => {
    const schema = schemas[typeName];
    if (!schema) throw new Error(`Unknown job type: "${typeName}"`);
    return schema;
  };
  const checkInput = (typeName: string, input: unknown): unknown => {
    validateFields(schemaFor(typeName).input, input, "input");
    return input;
  };
  const checkOutput = (typeName: string, output: unknown): unknown => {
    const schema = schemaFor(typeName).output;
    if (!schema) throw new Error(`"${typeName}" has no output schema`);
    validateFields(schema, output, "output");
    return output;
  };
  return createJobTypes<T>({
    getTypeNames: () => Object.keys(schemas),
    validateEntry: (typeName) => {
      const schema = schemas[typeName];
      if (!schema) throw new Error(`Unknown job type: "${typeName}"`);
      if (!schema.entry) throw new Error(`"${typeName}" is not an entry point`);
    },
    encodeInput: checkInput,
    decodeInput: checkInput,
    encodeOutput: checkOutput,
    decodeOutput: checkOutput,
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
};

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

type CodecJobTypeDefinitions = {
  timed: { entry: true; input: { at: Date }; output: { doneAt: Date } };
  lax: { entry: true; input: { n: number }; output: null };
  gated: { entry: true; input: null; output: null; blockers: [{ typeName: "timed" }] };
};

type CodecCall = { typeName: string; field: "input" | "output"; value: unknown };

const createCodecJobTypes = () => {
  const encodeCalls: CodecCall[] = [];
  const decodeCalls: CodecCall[] = [];
  const validatedBlockers: ResolvedJobTypeReference[] = [];
  let strictLax = false;

  const dateKey = (field: "input" | "output") => (field === "input" ? "at" : "doneAt");

  const encode =
    (field: "input" | "output") =>
    (typeName: string, value: unknown): unknown => {
      encodeCalls.push({ typeName, field, value });
      if (typeName !== "timed") return value;
      const key = dateKey(field);
      const date = (value as Record<string, unknown>)[key];
      if (!(date instanceof Date)) throw new Error(`expected a Date at "${key}"`);
      return { [key]: date.toISOString() };
    };
  const decode =
    (field: "input" | "output") =>
    (typeName: string, value: unknown): unknown => {
      decodeCalls.push({ typeName, field, value });
      if (typeName === "lax") {
        const n = (value as Record<string, unknown> | null)?.n;
        if (strictLax && typeof n !== "number") throw new Error(`expected a number at "n"`);
        return value;
      }
      if (typeName !== "timed") return value;
      const key = dateKey(field);
      const iso = (value as Record<string, unknown>)[key];
      if (typeof iso !== "string") throw new Error(`expected a string at "${key}"`);
      return { [key]: new Date(iso) };
    };

  const jobTypes = createJobTypes<CodecJobTypeDefinitions>({
    getTypeNames: () => ["timed", "lax", "gated"],
    validateEntry: () => {},
    encodeInput: encode("input"),
    decodeInput: decode("input"),
    encodeOutput: encode("output"),
    decodeOutput: decode("output"),
    validateContinueWith: () => {},
    validateBlockers: (_typeName, blockers) => {
      validatedBlockers.push(...blockers);
    },
  });

  return {
    jobTypes,
    encodeCalls,
    decodeCalls,
    validatedBlockers,
    setStrictLax: (strict: boolean) => {
      strictLax = strict;
    },
  };
};

// --- Test suite ---

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

export const validationTestSuite = ({ it }: { it: TestAPI<TestSuiteContext> }): void => {
  it("getTypeNames returns registered type names", () => {
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
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { value: 42 },
      }),
    );

    expect(chain.status).toBe("running");
    const startedJob = await client.getJob({ id: chain.id });
    expect(startedJob!.status).toBe("pending");
    expect(chain.input).toEqual({ value: 42 });
  });

  it("reports the encoded input when a chain is created", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: createJobTypes<{
        main: { entry: true; input: { value: number }; output: null };
      }>({
        getTypeNames: () => ["main"],
        validateEntry: () => {},
        encodeInput: (_typeName, input) => ({ ...(input as object), parsed: true }),
        decodeInput: (_typeName, input) => input,
        encodeOutput: (_typeName, output) => output,
        decodeOutput: (_typeName, output) => output,
        validateContinueWith: () => {},
        validateBlockers: () => {},
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { value: 42 },
      }),
    );

    expect(chain.input).toEqual({ value: 42, parsed: true });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chain_created",
        data: expect.objectContaining({ input: { value: 42, parsed: true } }),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "job_created",
        data: expect.objectContaining({ input: { value: 42, parsed: true } }),
      }),
    );
  });

  it("rejects non-entry type at chain start", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          // @ts-expect-error testing runtime validation
          typeName: "nonexistent",
          input: { value: 1 },
        }),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects invalid input at chain start", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          // @ts-expect-error testing runtime validation
          input: { value: "not-a-number" },
        }),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects invalid blockers at chain start", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: blockerJobTypes,
    });

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        // @ts-expect-error testing runtime validation - no blockers
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "main",
          input: { id: "main-1" },
        }),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("validates blockers against the stored chain, not the passed object", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const validatedBlockers: unknown[] = [];
    const jobTypes = createJobTypes<{
      main: {
        entry: true;
        input: null;
        output: null;
        blockers: [{ input: { token: string } }];
      };
      auth: { entry: true; input: { token: string }; output: null };
    }>({
      getTypeNames: () => ["main", "auth"],
      validateEntry: () => {},
      encodeInput: (_typeName, input) => input,
      decodeInput: (_typeName, input) => input,
      encodeOutput: (_typeName, output) => output,
      decodeOutput: (_typeName, output) => output,
      validateContinueWith: () => {},
      validateBlockers: (_typeName, blockers) => {
        validatedBlockers.push(...blockers);
      },
    });
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await withTransaction(async (txCtx, transactionHooks) => {
      const authChain = await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "auth",
        input: { token: "stored" },
      });
      const forgedAuthChain = { ...authChain, input: { token: "forged" } };
      await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: [forgedAuthChain],
      });
      await client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: null,
        blockers: [{ id: authChain.id }],
      });
    });

    expect(validatedBlockers).toEqual([
      { typeName: "auth", input: { token: "stored" } },
      { typeName: "auth", input: { token: "stored" } },
    ]);
  });

  it("accepts valid output during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
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
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: 84 } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { value: 42 },
      }),
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
                return await withTransaction(async (txCtx, transactionHooks) =>
                  // @ts-expect-error testing runtime validation
                  complete({ ...txCtx, transactionHooks, output: { result: "not-a-number" } }),
                );
              } catch (error) {
                validationFailed.resolve(error);
                throw error;
              }
            },
          },
        },
      }),
    });

    await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { value: 42 },
      }),
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
              withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  continueWith: { typeName: "step2", input: { data: 1 } },
                }),
              ),
          },
          step2: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: 42 } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
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
                return await withTransaction(async (txCtx, transactionHooks) =>
                  complete({
                    ...txCtx,
                    transactionHooks,
                    continueWith: { typeName: "step2", input: { data: 1 } },
                  }),
                );
              } catch (error) {
                validationFailed.resolve(error);
                throw error;
              }
            },
          },
          step2: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: 1 } }),
              ),
          },
        },
      }),
    });

    await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
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
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { value: 42 },
      }),
    );

    const completedChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) =>
          completeJob(job, async ({ complete }) => complete({ output: { result: 84 } })),
      }),
    );

    assert(completedChain.status === "completed");
    expect(completedChain.output).toEqual({ result: 84 });
  });

  it("rejects invalid output during workerless completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "main",
        input: { value: 42 },
      }),
    );

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          ...chain,
          handler: async ({ job, completeJob }) =>
            completeJob(job, async ({ complete }) =>
              // @ts-expect-error testing runtime validation
              complete({ output: { result: "not-a-number" } }),
            ),
        }),
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
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, transactionHooks) =>
                complete({ ...txCtx, transactionHooks, output: { result: 42 } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
    );

    const partialChain = await withTransaction(async (txCtx, transactionHooks) =>
      client.completeChain({
        ...txCtx,
        transactionHooks,
        ...chain,
        handler: async ({ job, completeJob }) => {
          if (job.typeName === "step1") {
            await completeJob(job, async ({ complete }) =>
              complete({ continueWith: { typeName: "step2", input: { data: 1 } } }),
            );
          }
        },
      }),
    );

    expect(partialChain.status).toBe("running");
    const partialTail = await client.listChainJobs({
      chainId: partialChain.id,
      orderDirection: "desc",
      limit: 1,
    });
    expect(partialTail.items[0].status).toBe("pending");

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
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationNoFollowUpJobTypes,
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
    );

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.completeChain({
          ...txCtx,
          transactionHooks,
          typeName: "step1",
          id: chain.id,
          handler: async ({ job, completeJob }) => {
            if (job.typeName === "step1") {
              await completeJob(job, async ({ complete }) =>
                complete({ continueWith: { typeName: "step2", input: { data: 1 } } }),
              );
            }
          },
        }),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("encodes the input of every chain created together", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const codec = createCodecJobTypes();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codec.jobTypes,
    });

    await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "timed", input: { at: new Date("2024-01-01T00:00:00.000Z") } },
          { typeName: "timed", input: { at: new Date("2024-02-01T00:00:00.000Z") } },
          { typeName: "lax", input: { n: 1 } },
        ],
      }),
    );

    expect(codec.encodeCalls.map(({ typeName, field }) => ({ typeName, field }))).toEqual([
      { typeName: "timed", field: "input" },
      { typeName: "timed", field: "input" },
      { typeName: "lax", field: "input" },
    ]);
  });

  it("rejects an encode failure as JobTypeValidationError", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const codec = createCodecJobTypes();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codec.jobTypes,
    });

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "timed",
          input: { at: "2024-01-01" as unknown as Date },
        }),
      ),
    ).rejects.toThrow(JobTypeValidationError);
  });

  it("rejects an encoded value that is not JSON-serializable", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: createJobTypes<CodecJobTypeDefinitions>({
        getTypeNames: () => ["timed"],
        validateEntry: () => {},
        encodeInput: (_typeName, input) => input,
        decodeInput: (_typeName, input) => input,
        encodeOutput: (_typeName, output) => output,
        decodeOutput: (_typeName, output) => output,
        validateContinueWith: () => {},
        validateBlockers: () => {},
      }),
    });

    await expect(
      withTransaction(async (txCtx, transactionHooks) =>
        client.createChain({
          ...txCtx,
          transactionHooks,
          typeName: "timed",
          input: { at: new Date("2024-01-01T00:00:00.000Z") },
        }),
      ),
    ).rejects.toThrow(/not JSON-serializable/);
  });

  it("decodes every input and every completed output on a page of jobs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const codec = createCodecJobTypes();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codec.jobTypes,
    });
    const seen: unknown[] = [];
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: codec.jobTypes,
        processors: {
          timed: {
            attemptHandler: async ({ job, complete }) => {
              seen.push(job.input.at);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: { doneAt: new Date("2024-03-01T00:00:00.000Z") },
                }),
              );
            },
          },
        },
      }),
    });

    const chains = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "timed", input: { at: new Date("2024-01-01T00:00:00.000Z") } },
          { typeName: "timed", input: { at: new Date("2024-02-01T00:00:00.000Z") } },
        ],
      }),
    );
    await withWorkers([await worker.start()], async () => {
      for (const chain of chains) {
        await client.awaitChain(chain, completionOptions);
      }
    });
    await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "timed",
        input: { at: new Date("2024-04-01T00:00:00.000Z") },
      }),
    );

    codec.decodeCalls.length = 0;
    const page = await client.listJobs({ typeName: "timed", limit: 10 });

    expect(page.items).toHaveLength(3);
    expect(codec.decodeCalls).toHaveLength(5);
    expect(codec.decodeCalls.filter((item) => item.field === "output")).toHaveLength(2);
  });

  it("rejects a persisted value the decoder rejects as JobTypeValidationError", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const codec = createCodecJobTypes();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codec.jobTypes,
    });

    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "lax",
        input: { n: "drifted" as unknown as number },
      }),
    );

    codec.setStrictLax(true);
    await expect(client.getJob({ id: chain.id })).rejects.toThrow(JobTypeValidationError);
  });

  it("reads jobs of a type the registry does not know with their stored values", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const writer = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: createCodecJobTypes().jobTypes,
    });
    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      writer.createChain({
        ...txCtx,
        transactionHooks,
        typeName: "timed",
        input: { at: new Date("2024-01-01T00:00:00.000Z") },
      }),
    );

    const reader = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    expect(await reader.getJob({ id: chain.id })).toMatchObject({
      typeName: "timed",
      input: { at: "2024-01-01T00:00:00.000Z" },
    });
  });

  it("hands the worker the decoded input and returns the decoded output to the client", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkers,
    observabilityAdapter,
    log,
  }) => {
    const codec = createCodecJobTypes();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codec.jobTypes,
    });
    const seen: unknown[] = [];
    const worker = await createInProcessWorker({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: codec.jobTypes,
        processors: {
          timed: {
            attemptHandler: async ({ job, complete }) => {
              seen.push(job.input.at);
              return withTransaction(async (txCtx, transactionHooks) =>
                complete({
                  ...txCtx,
                  transactionHooks,
                  output: { doneAt: new Date("2024-03-01T00:00:00.000Z") },
                }),
              );
            },
          },
        },
      }),
    });

    const at = new Date("2024-01-01T00:00:00.000Z");
    const chain = await withTransaction(async (txCtx, transactionHooks) =>
      client.createChain({ ...txCtx, transactionHooks, typeName: "timed", input: { at } }),
    );

    await withWorkers([await worker.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output.doneAt).toEqual(new Date("2024-03-01T00:00:00.000Z"));
    });

    expect(seen).toEqual([at]);
    const job = await client.getJob({ id: chain.id, typeName: "timed" });
    expect(job?.input.at).toEqual(at);
  });

  it("validates blockers against the decoded input of each stored chain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const codec = createCodecJobTypes();
    const client = await createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codec.jobTypes,
    });

    const at = new Date("2024-01-01T00:00:00.000Z");
    await withTransaction(async (txCtx, transactionHooks) => {
      const [first, second] = await client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "timed", input: { at } },
          { typeName: "timed", input: { at } },
        ],
      });
      codec.decodeCalls.length = 0;
      await client.createChains({
        ...txCtx,
        transactionHooks,
        items: [
          { typeName: "gated", input: null, blockers: [{ id: first.id }] },
          { typeName: "gated", input: null, blockers: [{ id: second.id }] },
        ],
      });
    });

    expect(codec.validatedBlockers).toEqual([
      { typeName: "timed", input: { at } },
      { typeName: "timed", input: { at } },
    ]);
    expect(codec.decodeCalls.filter((item) => item.typeName === "timed")).toEqual([
      { typeName: "timed", field: "input", value: { at: at.toISOString() } },
      { typeName: "timed", field: "input", value: { at: at.toISOString() } },
    ]);
  });
};
