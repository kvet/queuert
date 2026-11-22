import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

import { assertRejects } from "@queuert/helpers/assert-rejects";
import { dynamicSyncAsync, syncAsync, resource, step, wait } from "@queuert/sync-async";

import { createClient } from "../../client/client.ts";
import type { StateAdapterConformanceContext } from "../../conformance.state-adapter/types.ts";
import { runInModeOf } from "../../conformance/adapters.ts";
import type { ConformanceGroup } from "../../conformance/runner.ts";
import { JobTypeValidationError, JobsTypeValidationError } from "../../errors.ts";
import { createProcessors } from "../../job-type-processors/create-job-type-processors.ts";
import type { BaseJobTypeDefinitions } from "../../job-types/job-type.ts";
import { createJobTypes } from "../../job-types/job-types.ts";
import { createNoopObservabilityAdapter } from "../../observability-adapter/observability-adapter.noop.ts";
import { createWorkerRunner } from "../../worker/worker-runner.ts";
import { createCaseNotifyAdapter } from "../support/create-case-notify-adapter.ts";
import { createCaseStateAdapter } from "../support/create-case-state-adapter.ts";

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

const completionOptions = {
  pollIntervalMs: 100,
  timeoutMs: 5000,
};

export const validationGroup: ConformanceGroup<StateAdapterConformanceContext> = {
  name: "validation",
  cases: [
    {
      name: "getTypeNames returns registered type names",
      run: async () => {
        assert.deepEqual(simpleJobTypes.getTypeNames(), ["main"]);
        assert.partialDeepStrictEqual(
          new Set(continuationJobTypes.getTypeNames()),
          new Set(["step1", "step2"]),
        );
        assert.partialDeepStrictEqual(
          new Set(blockerJobTypes.getTypeNames()),
          new Set(["main", "auth"]),
        );
      },
    },
    {
      name: "accepts valid input at chain start",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: simpleJobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 42 },
            }),
          ),
        );

        assert.equal(chain.status, "running");
        const startedJob = yield* step(client.getJob({ id: chain.id }));
        assert.equal(startedJob!.status, "pending");
        assert.deepEqual(chain.input, { value: 42 });
      }),
    },
    {
      name: "reports the encoded input when a chain is created",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const chainCreated = Promise.withResolvers<unknown>();
        const jobCreated = Promise.withResolvers<unknown>();
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          observabilityAdapter: {
            ...createNoopObservabilityAdapter(),
            chainCreated: ({ input }) => {
              chainCreated.resolve(input);
            },
            jobCreated: ({ input }) => {
              jobCreated.resolve(input);
            },
          },
          jobTypes: codecJobTypes,
        });

        const at = new Date("2024-01-01T00:00:00.000Z");
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "timed", input: { at } }),
          ),
        );

        assert.deepEqual(chain.input, { at });
        assert.deepEqual(yield* wait(chainCreated.promise), { at: at.toISOString() });
        assert.deepEqual(yield* wait(jobCreated.promise), { at: at.toISOString() });
      }),
    },
    {
      name: "rejects non-entry type at chain start",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: simpleJobTypes });

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.createChain({
                  ...txCtx,
                  // @ts-expect-error testing runtime validation
                  typeName: "nonexistent",
                  input: { value: 1 },
                }),
              ),
            JobTypeValidationError,
          ),
        );
      }),
    },
    {
      name: "rejects invalid input at chain start",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: simpleJobTypes });

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "main",
                  // @ts-expect-error testing runtime validation
                  input: { value: "not-a-number" },
                }),
              ),
            JobTypeValidationError,
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.createChains({
                  ...txCtx,
                  items: [
                    // @ts-expect-error testing runtime validation
                    { typeName: "main", input: { value: "not-a-number" } },
                    { typeName: "main", input: { value: 1 } },
                    // @ts-expect-error testing runtime validation
                    { typeName: "main", input: { value: "also-not-a-number" } },
                  ],
                }),
              ),
            (error: unknown) => {
              assert.ok(error instanceof JobsTypeValidationError);
              assert.deepEqual(error.itemIndexes, [0, 2]);
              assert.deepEqual(
                error.errors.map(({ code }) => code),
                ["invalid_input", "invalid_input"],
              );
              return true;
            },
          ),
        );
      }),
    },
    {
      name: "rejects invalid blockers at chain start",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: blockerJobTypes });

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                // @ts-expect-error testing runtime validation - no blockers
                client.createChain({
                  ...txCtx,
                  typeName: "main",
                  input: { id: "main-1" },
                }),
              ),
            JobTypeValidationError,
          ),
        );
      }),
    },
    {
      name: "validates blockers against the stored chain, not the passed object",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
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
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes });

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const authChain = yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "auth",
                    input: { token: "stored" },
                  }),
                );
                const forgedAuthChain = { ...authChain, input: { token: "forged" } };
                yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "main",
                    input: null,
                    blockers: [forgedAuthChain],
                  }),
                );
                yield* step(
                  client.createChain({
                    ...txCtx,
                    typeName: "main",
                    input: null,
                    blockers: [{ id: authChain.id }],
                  }),
                );
              }),
            ),
          ),
        );

        assert.deepEqual(validatedBlockers, [
          { typeName: "auth", input: { token: "stored" } },
          { typeName: "auth", input: { token: "stored" } },
        ]);
      }),
    },
    {
      name: "accepts valid output during worker completion",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: simpleJobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes: simpleJobTypes,
              processors: {
                main: {
                  attemptHandler: async ({ applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { result: 84 } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 42 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { result: 84 });
      }),
    },
    {
      name: "rejects invalid output during worker completion",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const validationFailed = Promise.withResolvers<unknown>();

        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: simpleJobTypes });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes: simpleJobTypes,
              processors: {
                main: {
                  attemptHandler: async ({ applyOutcome }) => {
                    try {
                      return await stateAdapter.withTransaction((txCtx) =>
                        // @ts-expect-error testing runtime validation
                        applyOutcome({ ...txCtx, output: { result: "not-a-number" } }),
                      );
                    } catch (error) {
                      validationFailed.resolve(error);
                      throw error;
                    }
                  },
                },
              },
            }),
          }),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 42 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const error = yield* wait(validationFailed.promise);
        assert.ok(error instanceof JobTypeValidationError);
      }),
    },
    {
      name: "accepts valid continueWith during worker completion",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes: continuationJobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes: continuationJobTypes,
              processors: {
                step1: {
                  attemptHandler: async ({ applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({
                        ...txCtx,
                        continueWith: { typeName: "step2", input: { data: 1 } },
                      }),
                    ),
                },
                step2: {
                  attemptHandler: async ({ applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { result: 42 } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 1 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { result: 42 });
      }),
    },
    {
      name: "rejects invalid continueWith during worker completion",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const validationFailed = Promise.withResolvers<unknown>();

        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes: continuationNoFollowUpJobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes: continuationNoFollowUpJobTypes,
              processors: {
                step1: {
                  attemptHandler: async ({ applyOutcome }) => {
                    try {
                      return await stateAdapter.withTransaction((txCtx) =>
                        applyOutcome({
                          ...txCtx,
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
                  attemptHandler: async ({ applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { result: 1 } }),
                    ),
                },
              },
            }),
          }),
        );

        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 1 },
            }),
          ),
        );

        yield* wait(workerRunner.start());
        const error = yield* wait(validationFailed.promise);
        assert.ok(error instanceof JobTypeValidationError);
      }),
    },
    {
      name: "accepts valid output during workerless completion",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: simpleJobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 42 },
            }),
          ),
        );

        const completedChain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "main" },
              output: { result: 84 },
            }),
          ),
        );

        if (completedChain.status !== "completed") {
          throw new Error("expected a completed chain");
        }
        assert.deepEqual(completedChain.output, { result: 84 });
      }),
    },
    {
      name: "rejects invalid output during workerless completion",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: simpleJobTypes });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "main",
              input: { value: 42 },
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: chain.id, typeName: "main" },
                  // @ts-expect-error testing runtime validation
                  output: { result: "not-a-number" },
                }),
              ),
            JobTypeValidationError,
          ),
        );
      }),
    },
    {
      name: "accepts valid continueWith during workerless completion",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes: continuationJobTypes,
        });
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes: continuationJobTypes,
              processors: {
                step2: {
                  attemptHandler: async ({ applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { result: 42 } }),
                    ),
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 1 },
            }),
          ),
        );

        const continuedJob = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.applyJobOutcome({
              ...txCtx,
              job: { id: chain.id, typeName: "step1" },
              continueWith: { typeName: "step2", input: { data: 1 } },
            }),
          ),
        );

        assert.equal(continuedJob.status, "completed");
        assert.equal(continuedJob.continuedTo.status, "pending");

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { result: 42 });
      }),
    },
    {
      name: "rejects invalid continueWith during workerless completion",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({
          stateAdapter,
          notifyAdapter,
          jobTypes: continuationNoFollowUpJobTypes,
        });

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({
              ...txCtx,
              typeName: "step1",
              input: { value: 1 },
            }),
          ),
        );

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.applyJobOutcome({
                  ...txCtx,
                  job: { id: chain.id, typeName: "step1" },
                  continueWith: { typeName: "step2", input: { data: 1 } },
                }),
              ),
            JobTypeValidationError,
          ),
        );
      }),
    },
    {
      name: "rejects an encode failure as JobTypeValidationError",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: codecJobTypes });

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "timed",
                  input: { at: "2024-01-01" as unknown as Date },
                }),
              ),
            JobTypeValidationError,
          ),
        );
      }),
    },
    {
      name: "rejects an encoded value that is not JSON-serializable",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({
          stateAdapter,
          notifyAdapter,
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

        yield* step(
          assertRejects(
            () =>
              stateAdapter.withTransaction((txCtx) =>
                client.createChain({
                  ...txCtx,
                  typeName: "timed",
                  input: { at: new Date("2024-01-01T00:00:00.000Z") },
                }),
              ),
            (error: { code: string; details: { path: unknown } }) => {
              assert.equal(error.code, "invalid_input");
              assert.deepEqual(error.details.path, ["at"]);
              return true;
            },
          ),
        );
      }),
    },
    {
      name: "decodes every input and every completed output on a page of jobs",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: codecJobTypes });
        const doneAt = new Date("2024-03-01T00:00:00.000Z");
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes: codecJobTypes,
              processors: {
                timed: {
                  attemptHandler: async ({ applyOutcome }) =>
                    stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { doneAt } }),
                    ),
                },
              },
            }),
          }),
        );

        const first = new Date("2024-01-01T00:00:00.000Z");
        const second = new Date("2024-02-01T00:00:00.000Z");
        const pending = new Date("2024-04-01T00:00:00.000Z");
        const chains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChains({
              ...txCtx,
              items: [
                { typeName: "timed", input: { at: first } },
                { typeName: "timed", input: { at: second } },
              ],
            }),
          ),
        );
        yield* wait(workerRunner.start());
        yield* wait(client.awaitChains({ chains, ...completionOptions }));
        yield* wait(workerRunner.close());
        yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "timed", input: { at: pending } }),
          ),
        );

        const page = yield* step(client.listJobs({ typeName: "timed", limit: 10 }));

        for (const input of [{ at: first }, { at: second }, { at: pending }]) {
          assert.ok(page.items.some((job) => isDeepStrictEqual(job.input, input)));
        }
        assert.deepEqual(
          page.items.flatMap((job) => (job.status === "completed" ? [job.output] : [])),
          [{ doneAt }, { doneAt }],
        );
      }),
    },
    {
      name: "rejects a stored value the decoder rejects as JobTypeValidationError",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const writer = createClient({ stateAdapter, notifyAdapter, jobTypes: codecJobTypes });
        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            writer.createChain({
              ...txCtx,
              typeName: "timed",
              input: { at: new Date("2024-01-01T00:00:00.000Z") },
            }),
          ),
        );

        const reader = createClient({
          stateAdapter,
          notifyAdapter,
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

        yield* step(assertRejects(() => reader.getJob({ id: chain.id }), JobTypeValidationError));
      }),
    },
    {
      name: "reads chains created together in their stored form when the registry does not know the type",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const writer = createClient({ stateAdapter, notifyAdapter, jobTypes: codecJobTypes });
        const [first, second] = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            writer.createChains({
              ...txCtx,
              items: [
                { typeName: "timed", input: { at: new Date("2024-01-01T00:00:00.000Z") } },
                { typeName: "timed", input: { at: new Date("2024-02-01T00:00:00.000Z") } },
              ],
            }),
          ),
        );

        const reader = createClient({ stateAdapter, notifyAdapter, jobTypes: simpleJobTypes });

        assert.partialDeepStrictEqual(yield* step(reader.getJob({ id: first.id })), {
          typeName: "timed",
          input: { at: "2024-01-01T00:00:00.000Z" },
        });
        assert.partialDeepStrictEqual(yield* step(reader.getJob({ id: second.id })), {
          typeName: "timed",
          input: { at: "2024-02-01T00:00:00.000Z" },
        });
      }),
    },
    {
      name: "hands the worker the decoded input and returns the decoded output to the client",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: codecJobTypes });
        const at = new Date("2024-01-01T00:00:00.000Z");
        const doneAt = new Date("2024-03-01T00:00:00.000Z");
        const workerRunner = yield* resource(
          createWorkerRunner({
            client,
            concurrency: 1,
            processors: createProcessors({
              client,
              jobTypes: codecJobTypes,
              processors: {
                timed: {
                  attemptHandler: async ({ job, applyOutcome }) => {
                    assert.deepEqual(job.input, { at });
                    return stateAdapter.withTransaction((txCtx) =>
                      applyOutcome({ ...txCtx, output: { doneAt } }),
                    );
                  },
                },
              },
            }),
          }),
        );

        const chain = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            client.createChain({ ...txCtx, typeName: "timed", input: { at } }),
          ),
        );

        yield* wait(workerRunner.start());
        const completed = yield* wait(client.awaitChain({ chain, ...completionOptions }));
        assert.deepEqual(completed.output, { doneAt });
        assert.partialDeepStrictEqual(
          yield* step(client.getJob({ id: chain.id, typeName: "timed" })),
          {
            input: { at },
          },
        );
      }),
    },
    {
      name: "validates blockers against the decoded input of each stored chain",
      run: dynamicSyncAsync(function* ({ createStateAdapter, createNotifyAdapter }) {
        const stateAdapter = yield* resource(createCaseStateAdapter(createStateAdapter));
        const notifyAdapter = yield* resource(
          createCaseNotifyAdapter(createNotifyAdapter, stateAdapter),
        );
        const client = createClient({ stateAdapter, notifyAdapter, jobTypes: codecJobTypes });

        const gatedChains = yield* step(
          stateAdapter.withTransaction((txCtx) =>
            runInModeOf(
              stateAdapter,
              syncAsync(function* () {
                const [first, second] = yield* step(
                  client.createChains({
                    ...txCtx,
                    items: [
                      { typeName: "timed", input: { at: new Date("2024-01-01T00:00:00.000Z") } },
                      { typeName: "timed", input: { at: new Date("2024-02-01T00:00:00.000Z") } },
                    ],
                  }),
                );
                return yield* step(
                  client.createChains({
                    ...txCtx,
                    items: [
                      { typeName: "gated", input: null, blockers: [{ id: first.id }] },
                      { typeName: "gated", input: null, blockers: [{ id: second.id }] },
                    ],
                  }),
                );
              }),
            ),
          ),
        );
        assert.equal(gatedChains.length, 2);
      }),
    },
  ],
};
