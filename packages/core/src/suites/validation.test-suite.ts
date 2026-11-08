import { type TestAPI, assert, expect } from "vitest";

import { createClient } from "../client.ts";
import { JobTypeValidationError } from "../errors.ts";
import { createProcessors } from "../job-type-processors/create-job-type-processors.ts";
import type { BaseJobTypeDefinitions } from "../job-types/job-type.ts";
import { createJobTypes } from "../job-types/job-types.ts";
import { createWorkerRunner } from "../worker-runner.ts";
import type { TestSuiteContext } from "./spec-context.spec-helper.ts";

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
  gated: { entry: true; input: null; output: null; blockers: [{ typeName: "timed" }] };
};

const createDateCodec = (key: string) => ({
  encode: (typeName: string, value: unknown): unknown => {
    if (typeName !== "timed") return value;
    const date = (value as Record<string, unknown>)[key];
    if (!(date instanceof Date)) throw new Error(`expected a Date at "${key}"`);
    return { [key]: date.toISOString() };
  },
  decode: (typeName: string, value: unknown): unknown => {
    if (typeName !== "timed") return value;
    const iso = (value as Record<string, unknown>)[key];
    if (typeof iso !== "string") throw new Error(`expected a string at "${key}"`);
    return { [key]: new Date(iso) };
  },
});

const inputDateCodec = createDateCodec("at");
const outputDateCodec = createDateCodec("doneAt");

const codecJobTypes = createJobTypes<CodecJobTypeDefinitions>({
  getTypeNames: () => ["timed", "gated"],
  validateEntry: () => {},
  encodeInput: inputDateCodec.encode,
  decodeInput: inputDateCodec.decode,
  encodeOutput: outputDateCodec.encode,
  decodeOutput: outputDateCodec.decode,
  validateContinueWith: () => {},
  validateBlockers: (_typeName, blockers) => {
    if (!blockers.every((blocker) => (blocker.input as { at: unknown }).at instanceof Date)) {
      throw new Error('expected every blocker to hold a Date at "at"');
    }
  },
});

const passThrough = (_typeName: string, value: unknown): unknown => value;

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
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
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
    const chainCreated = Promise.withResolvers<unknown>();
    const jobCreated = Promise.withResolvers<unknown>();
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter: {
        ...observabilityAdapter,
        chainCreated: ({ input }) => {
          chainCreated.resolve(input);
        },
        jobCreated: ({ input }) => {
          jobCreated.resolve(input);
        },
      },
      log,
      jobTypes: codecJobTypes,
    });

    const at = new Date("2024-01-01T00:00:00.000Z");
    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "timed", input: { at } }),
    );

    expect(chain.input).toEqual({ at });
    await expect(chainCreated.promise).resolves.toEqual({ at: at.toISOString() });
    await expect(jobCreated.promise).resolves.toEqual({ at: at.toISOString() });
  });

  it("rejects non-entry type at chain start", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.createChain({
          ...txCtx,
          txHooks,
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
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.createChain({
          ...txCtx,
          txHooks,
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
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: blockerJobTypes,
    });

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        // @ts-expect-error testing runtime validation - no blockers
        client.createChain({
          ...txCtx,
          txHooks,
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
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes,
    });

    await withTransaction(async (txCtx, txHooks) => {
      const authChain = await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "auth",
        input: { token: "stored" },
      });
      const forgedAuthChain = { ...authChain, input: { token: "forged" } };
      await client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: null,
        blockers: [forgedAuthChain],
      });
      await client.createChain({
        ...txCtx,
        txHooks,
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
    withWorkerRunners,
    observabilityAdapter,
    log,
  }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });
    const workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: simpleJobTypes,
        processors: {
          main: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { result: 84 } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: { value: 42 },
      }),
    );

    await withWorkerRunners([await workerRunner.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 84 });
    });
  });

  it("rejects invalid output during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkerRunners,
    observabilityAdapter,
    log,
  }) => {
    const validationFailed = Promise.withResolvers<unknown>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });
    const workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: simpleJobTypes,
        processors: {
          main: {
            attemptHandler: async ({ complete }) => {
              try {
                return await withTransaction(async (txCtx, txHooks) =>
                  // @ts-expect-error testing runtime validation
                  complete({ ...txCtx, txHooks, output: { result: "not-a-number" } }),
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

    await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: { value: 42 },
      }),
    );

    await withWorkerRunners([await workerRunner.start()], async () => {
      const error = await validationFailed.promise;
      expect(error).toBeInstanceOf(JobTypeValidationError);
    });
  });

  it("accepts valid continueWith during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkerRunners,
    observabilityAdapter,
    log,
  }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationJobTypes,
    });
    const workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: continuationJobTypes,
        processors: {
          step1: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, txHooks) =>
                complete({
                  ...txCtx,
                  txHooks,
                  continueWith: { typeName: "step2", input: { data: 1 } },
                }),
              ),
          },
          step2: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { result: 42 } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
    );

    await withWorkerRunners([await workerRunner.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ result: 42 });
    });
  });

  it("rejects invalid continueWith during worker completion", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkerRunners,
    observabilityAdapter,
    log,
  }) => {
    const validationFailed = Promise.withResolvers<unknown>();

    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationNoFollowUpJobTypes,
    });
    const workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: continuationNoFollowUpJobTypes,
        processors: {
          step1: {
            attemptHandler: async ({ complete }) => {
              try {
                return await withTransaction(async (txCtx, txHooks) =>
                  complete({
                    ...txCtx,
                    txHooks,
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
              withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { result: 1 } }),
              ),
          },
        },
      }),
    });

    await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
    );

    await withWorkerRunners([await workerRunner.start()], async () => {
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
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: { value: 42 },
      }),
    );

    const completedChain = await withTransaction(async (txCtx, txHooks) =>
      client.completeChain({
        ...txCtx,
        txHooks,
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
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "main",
        input: { value: 42 },
      }),
    );

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.completeChain({
          ...txCtx,
          txHooks,
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
    withWorkerRunners,
    observabilityAdapter,
    log,
  }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationJobTypes,
    });
    const workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: continuationJobTypes,
        processors: {
          step2: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { result: 42 } }),
              ),
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
    );

    const partialChain = await withTransaction(async (txCtx, txHooks) =>
      client.completeChain({
        ...txCtx,
        txHooks,
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

    await withWorkerRunners([await workerRunner.start()], async () => {
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
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: continuationNoFollowUpJobTypes,
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({
        ...txCtx,
        txHooks,
        typeName: "step1",
        input: { value: 1 },
      }),
    );

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.completeChain({
          ...txCtx,
          txHooks,
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

  it("rejects an encode failure as JobTypeValidationError", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codecJobTypes,
    });

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.createChain({
          ...txCtx,
          txHooks,
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
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: createJobTypes<CodecJobTypeDefinitions>({
        getTypeNames: () => ["timed"],
        validateEntry: () => {},
        encodeInput: passThrough,
        decodeInput: passThrough,
        encodeOutput: passThrough,
        decodeOutput: passThrough,
        validateContinueWith: () => {},
        validateBlockers: () => {},
      }),
    });

    await expect(
      withTransaction(async (txCtx, txHooks) =>
        client.createChain({
          ...txCtx,
          txHooks,
          typeName: "timed",
          input: { at: new Date("2024-01-01T00:00:00.000Z") },
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_input", details: { path: ["at"] } });
  });

  it("decodes every input and every completed output on a page of jobs", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkerRunners,
    observabilityAdapter,
    log,
  }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codecJobTypes,
    });
    const doneAt = new Date("2024-03-01T00:00:00.000Z");
    const workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: codecJobTypes,
        processors: {
          timed: {
            attemptHandler: async ({ complete }) =>
              withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { doneAt } }),
              ),
          },
        },
      }),
    });

    const first = new Date("2024-01-01T00:00:00.000Z");
    const second = new Date("2024-02-01T00:00:00.000Z");
    const pending = new Date("2024-04-01T00:00:00.000Z");
    const chains = await withTransaction(async (txCtx, txHooks) =>
      client.createChains({
        ...txCtx,
        txHooks,
        items: [
          { typeName: "timed", input: { at: first } },
          { typeName: "timed", input: { at: second } },
        ],
      }),
    );
    await withWorkerRunners([await workerRunner.start()], async () => {
      await Promise.all(chains.map(async (chain) => client.awaitChain(chain, completionOptions)));
    });
    await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "timed", input: { at: pending } }),
    );

    const page = await client.listJobs({ typeName: "timed", limit: 10 });

    expect(page.items.map((job) => job.input)).toEqual(
      expect.arrayContaining([{ at: first }, { at: second }, { at: pending }]),
    );
    expect(page.items.flatMap((job) => (job.status === "completed" ? [job.output] : []))).toEqual([
      { doneAt },
      { doneAt },
    ]);
  });

  it("rejects a stored value the decoder rejects as JobTypeValidationError", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const writer = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codecJobTypes,
    });
    const chain = await withTransaction(async (txCtx, txHooks) =>
      writer.createChain({
        ...txCtx,
        txHooks,
        typeName: "timed",
        input: { at: new Date("2024-01-01T00:00:00.000Z") },
      }),
    );

    const reader = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: createJobTypes<CodecJobTypeDefinitions>({
        getTypeNames: () => ["timed"],
        validateEntry: () => {},
        encodeInput: passThrough,
        decodeInput: () => {
          throw new Error("expected a timestamp in milliseconds");
        },
        encodeOutput: passThrough,
        decodeOutput: passThrough,
        validateContinueWith: () => {},
        validateBlockers: () => {},
      }),
    });

    await expect(reader.getJob({ id: chain.id })).rejects.toThrow(JobTypeValidationError);
  });

  it("reads chains created together in their stored form when the registry does not know the type", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const writer = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codecJobTypes,
    });
    const [first, second] = await withTransaction(async (txCtx, txHooks) =>
      writer.createChains({
        ...txCtx,
        txHooks,
        items: [
          { typeName: "timed", input: { at: new Date("2024-01-01T00:00:00.000Z") } },
          { typeName: "timed", input: { at: new Date("2024-02-01T00:00:00.000Z") } },
        ],
      }),
    );

    const reader = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: simpleJobTypes,
    });

    await expect(reader.getJob({ id: first.id })).resolves.toMatchObject({
      typeName: "timed",
      input: { at: "2024-01-01T00:00:00.000Z" },
    });
    await expect(reader.getJob({ id: second.id })).resolves.toMatchObject({
      typeName: "timed",
      input: { at: "2024-02-01T00:00:00.000Z" },
    });
  });

  it("hands the worker the decoded input and returns the decoded output to the client", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    withWorkerRunners,
    observabilityAdapter,
    log,
  }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codecJobTypes,
    });
    const at = new Date("2024-01-01T00:00:00.000Z");
    const doneAt = new Date("2024-03-01T00:00:00.000Z");
    const workerRunner = createWorkerRunner({
      client,
      concurrency: 1,
      processors: createProcessors({
        client,
        jobTypes: codecJobTypes,
        processors: {
          timed: {
            attemptHandler: async ({ job, complete }) => {
              expect(job.input).toEqual({ at });
              return withTransaction(async (txCtx, txHooks) =>
                complete({ ...txCtx, txHooks, output: { doneAt } }),
              );
            },
          },
        },
      }),
    });

    const chain = await withTransaction(async (txCtx, txHooks) =>
      client.createChain({ ...txCtx, txHooks, typeName: "timed", input: { at } }),
    );

    await withWorkerRunners([await workerRunner.start()], async () => {
      const completed = await client.awaitChain(chain, completionOptions);
      expect(completed.output).toEqual({ doneAt });
    });
    await expect(client.getJob({ id: chain.id, typeName: "timed" })).resolves.toMatchObject({
      input: { at },
    });
  });

  it("validates blockers against the decoded input of each stored chain", async ({
    stateAdapter,
    notifyAdapter,
    withTransaction,
    observabilityAdapter,
    log,
  }) => {
    const client = createClient({
      stateAdapter,
      notifyAdapter,
      observabilityAdapter,
      log,
      jobTypes: codecJobTypes,
    });

    await withTransaction(async (txCtx, txHooks) => {
      const [first, second] = await client.createChains({
        ...txCtx,
        txHooks,
        items: [
          { typeName: "timed", input: { at: new Date("2024-01-01T00:00:00.000Z") } },
          { typeName: "timed", input: { at: new Date("2024-02-01T00:00:00.000Z") } },
        ],
      });
      await expect(
        client.createChains({
          ...txCtx,
          txHooks,
          items: [
            { typeName: "gated", input: null, blockers: [{ id: first.id }] },
            { typeName: "gated", input: null, blockers: [{ id: second.id }] },
          ],
        }),
      ).resolves.toHaveLength(2);
    });
  });
};
