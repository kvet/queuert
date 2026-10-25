import { describe, expect, expectTypeOf, it } from "vitest";

import { type AttemptMiddleware } from "../attempt-middleware/attempt-middleware.js";
import { createClient } from "../client.js";
import { DuplicateJobTypeError } from "../errors.js";
import { createInProcessWorker } from "../in-process-worker.js";
import { defineJobTypes } from "../job-types/define-job-types.js";
import {
  createInProcessStateAdapter,
  type InProcessStateAdapter,
} from "../state-adapter/state-adapter.in-process.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { createProcessors } from "./create-job-type-processors.js";
import {
  type ProcessorDefinitions,
  type ProcessorMiddlewareTuple,
  processorAttemptMiddlewareSymbol,
  processorsMiddlewareSymbol,
} from "./job-type-processors.js";
import { omitProcessors, pickProcessors } from "./pick-job-type-processors.js";

type ImageDefs = {
  "images.resize": { entry: true; input: { url: string }; output: { url: string } };
  "images.transcode": { entry: true; input: { url: string }; output: { url: string } };
  "images.notify": { entry: true; input: { url: string }; output: null };
};
type BillingDefs = {
  "billing.charge": { entry: true; input: { amount: number }; output: null };
};

const imageJobTypes = defineJobTypes<ImageDefs>();
const billingJobTypes = defineJobTypes<BillingDefs>();

const stateAdapter = createInProcessStateAdapter();
const client = createClient({
  stateAdapter,
  jobTypes: [imageJobTypes, billingJobTypes],
});

const traceMiddleware: AttemptMiddleware<InProcessStateAdapter, { traceId: string }> = {
  wrapHandler: async ({ next }) => next({ traceId: "t-1" }),
};

const imageProcessors = createProcessors({
  client,
  jobTypes: imageJobTypes,
  attemptMiddleware: [traceMiddleware],
  backoffConfig: { initialDelayMs: 10, multiplier: 2, maxDelayMs: 100 },
  processors: {
    "images.resize": {
      attemptHandler: async ({ job, complete }) =>
        withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, transactionHooks, output: { url: job.input.url } }),
          ),
        ),
    },
    "images.transcode": {
      attemptHandler: async ({ job, complete }) =>
        withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, transactionHooks, output: { url: job.input.url } }),
          ),
        ),
    },
    "images.notify": {
      attemptHandler: async ({ complete }) =>
        withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, transactionHooks, output: null }),
          ),
        ),
    },
  },
});

const billingProcessors = createProcessors({
  client,
  jobTypes: billingJobTypes,
  processors: {
    "billing.charge": {
      attemptHandler: async ({ complete }) =>
        withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (txCtx) =>
            complete({ ...txCtx, transactionHooks, output: null }),
          ),
        ),
    },
  },
});

describe("pickProcessors", () => {
  it("keeps only the listed processors, unchanged", () => {
    const picked = pickProcessors(imageProcessors, ["images.resize", "images.transcode"]);

    expect(Object.keys(picked)).toEqual(["images.resize", "images.transcode"]);
    expect(picked["images.resize"]).toBe(imageProcessors["images.resize"]);
    expect(picked["images.resize"].backoffConfig).toEqual({
      initialDelayMs: 10,
      multiplier: 2,
      maxDelayMs: 100,
    });
    expect(
      (picked["images.resize"] as unknown as Record<symbol, unknown>)[
        processorAttemptMiddlewareSymbol
      ],
    ).toEqual([traceMiddleware]);
    expect(picked[processorsMiddlewareSymbol]).toEqual([traceMiddleware]);
  });

  it("narrows definitions and keeps the middleware tuple type", () => {
    const picked = pickProcessors(imageProcessors, ["images.resize"]);

    expectTypeOf<ProcessorDefinitions<typeof picked>>().toEqualTypeOf<
      Pick<ImageDefs, "images.resize">
    >();
    expectTypeOf<ProcessorMiddlewareTuple<typeof picked>>().toEqualTypeOf<
      readonly [typeof traceMiddleware]
    >();
  });

  it("rejects unknown job types and an empty list", () => {
    // @ts-expect-error — "images.crop" has no processor
    expect(() => pickProcessors(imageProcessors, ["images.crop"])).toThrow(
      "pickProcessors: processors do not include job types: images.crop",
    );
    // @ts-expect-error — at least one job type is required
    expect(() => pickProcessors(imageProcessors, [])).toThrow(
      "pickProcessors: at least one job type name is required",
    );
  });
});

describe("omitProcessors", () => {
  it("keeps every processor except the listed ones", () => {
    const rest = omitProcessors(imageProcessors, ["images.resize", "images.transcode"]);

    expect(Object.keys(rest)).toEqual(["images.notify"]);
    expect(rest["images.notify"]).toBe(imageProcessors["images.notify"]);
    expectTypeOf<ProcessorDefinitions<typeof rest>>().toEqualTypeOf<
      Pick<ImageDefs, "images.notify">
    >();
  });

  it("rejects unknown job types and omitting every processor", () => {
    // @ts-expect-error — "images.crop" has no processor
    expect(() => omitProcessors(imageProcessors, ["images.crop"])).toThrow(
      "omitProcessors: processors do not include job types: images.crop",
    );
    expect(() =>
      // @ts-expect-error — nothing would be left to process
      omitProcessors(imageProcessors, ["images.resize", "images.transcode", "images.notify"]),
    ).toThrow("omitProcessors: selection leaves no processors");
  });

  it("covers every processor together with pickProcessors", () => {
    const dedicatedTypeNames = ["images.resize", "images.transcode"] as const;
    const dedicated = pickProcessors(imageProcessors, dedicatedTypeNames);
    const rest = omitProcessors(imageProcessors, dedicatedTypeNames);

    expect([...Object.keys(dedicated), ...Object.keys(rest)].sort()).toEqual(
      Object.keys(imageProcessors).sort(),
    );
  });
});

describe("picked registries in a worker's processors array", () => {
  it("rejects overlapping picks from the same registry", async () => {
    expect(() =>
      createInProcessWorker({
        client,
        processors: [
          pickProcessors(imageProcessors, ["images.resize", "images.transcode"]),
          // @ts-expect-error — "images.transcode" is picked twice
          pickProcessors(imageProcessors, ["images.transcode", "images.notify"]),
        ],
      }),
    ).toThrow(DuplicateJobTypeError);
  });

  it("checks requiredAttemptMiddleware against each picked slice", async () => {
    expect(() =>
      createInProcessWorker({
        client,
        requiredAttemptMiddleware: [traceMiddleware],
        processors: [
          pickProcessors(imageProcessors, ["images.resize"]),
          // @ts-expect-error — the billing slice has no traceMiddleware
          pickProcessors(billingProcessors, ["billing.charge"]),
        ],
      }),
    ).toThrow("missing requiredAttemptMiddleware");
  });
});
