import { describe, expectTypeOf, it } from "vitest";

import { createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import {
  type AttemptMiddleware,
  type MergedAttemptHandlerCtx,
  type MergedCompleteCtx,
  type MergedPrepareCtx,
} from "./attempt-middleware.js";
import { createProcessors } from "./create-processors.js";

type Defs = {
  foo: { entry: true; input: { v: number }; output: { ok: true } };
};
const jobTypes = defineJobTypes<Defs>();

const stateAdapter = await createInProcessStateAdapter();
const client = await createClient({ stateAdapter, jobTypes });

type W1<C extends Record<string, unknown>> = AttemptMiddleware<any, C>;
type W3<
  H extends Record<string, unknown>,
  P extends Record<string, unknown>,
  C extends Record<string, unknown>,
> = AttemptMiddleware<any, H, P, C>;

describe("AttemptMiddleware ctx type inference", () => {
  it("MergedAttemptHandlerCtx distributes across middleware (1, 4, 5, 8)", () => {
    expectTypeOf<MergedAttemptHandlerCtx<readonly [W1<{ a: string }>]>>().toEqualTypeOf<{
      a: string;
    }>();

    expectTypeOf<
      MergedAttemptHandlerCtx<
        readonly [W1<{ a: string }>, W1<{ b: number }>, W1<{ c: boolean }>, W1<{ d: null }>]
      >
    >().toEqualTypeOf<{ a: string } & { b: number } & { c: boolean } & { d: null }>();

    expectTypeOf<
      MergedAttemptHandlerCtx<
        readonly [
          W1<{ a: string }>,
          W1<{ b: number }>,
          W1<{ c: boolean }>,
          W1<{ d: null }>,
          W1<{ e: 1 }>,
        ]
      >
    >().toEqualTypeOf<{ a: string } & { b: number } & { c: boolean } & { d: null } & { e: 1 }>();

    expectTypeOf<
      MergedAttemptHandlerCtx<
        readonly [
          W1<{ a: string }>,
          W1<{ b: number }>,
          W1<{ c: boolean }>,
          W1<{ d: null }>,
          W1<{ e: 1 }>,
          W1<{ f: 2 }>,
          W1<{ g: 3 }>,
          W1<{ h: 4 }>,
        ]
      >
    >().toEqualTypeOf<
      { a: string } & { b: number } & { c: boolean } & { d: null } & {
        e: 1;
      } & { f: 2 } & { g: 3 } & { h: 4 }
    >();
  });

  it("MergedPrepareCtx / MergedCompleteCtx pick only their phase", () => {
    expectTypeOf<MergedPrepareCtx<readonly [W3<{ h: 1 }, { p: 2 }, { c: 3 }>]>>().toEqualTypeOf<{
      p: 2;
    }>();
    expectTypeOf<MergedCompleteCtx<readonly [W3<{ h: 1 }, { p: 2 }, { c: 3 }>]>>().toEqualTypeOf<{
      c: 3;
    }>();
  });

  it("attemptHandler receives merged handler ctx", () => {
    const w1: AttemptMiddleware<any, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t" }),
    };
    const w2: AttemptMiddleware<any, { log: (msg: string) => void }> = {
      wrapHandler: async ({ next }) => next({ log: () => {} }),
    };

    createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [w1, w2],
      processors: {
        foo: {
          attemptHandler: async ({ traceId, log, complete }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
            expectTypeOf(log).toEqualTypeOf<(msg: string) => void>();
            return complete(async () => ({ ok: true as const }));
          },
        },
      },
    });
  });

  it("prepareCallback options include prepare ctx alongside txCtx", () => {
    const w: AttemptMiddleware<any, {}, { tag: string }> = {
      wrapPrepare: async ({ next }) => next({ tag: "t" }),
    };

    createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [w],
      processors: {
        foo: {
          attemptHandler: async ({ prepare, complete }) => {
            await prepare({ mode: "atomic" }, async ({ tag }) => {
              expectTypeOf(tag).toEqualTypeOf<string>();
            });
            return complete(async () => ({ ok: true as const }));
          },
        },
      },
    });
  });

  it("completeCallback options include complete ctx alongside continueWith & txCtx", () => {
    const w: AttemptMiddleware<any, {}, {}, { audit: (evt: string) => void }> = {
      wrapComplete: async ({ next }) => next({ audit: () => {} }),
    };

    createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [w],
      processors: {
        foo: {
          attemptHandler: async ({ complete }) =>
            complete(async ({ audit, continueWith: _continueWith, transactionHooks: _t }) => {
              expectTypeOf(audit).toEqualTypeOf<(evt: string) => void>();
              return { ok: true as const };
            }),
        },
      },
    });
  });
});

describe("tuple narrowing without `as const`", () => {
  it("inline middleware tuple narrows so handler ctx is precise", () => {
    const traceMw: AttemptMiddleware<any, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t" }),
    };
    const logMw: AttemptMiddleware<any, { log: (msg: string) => void }> = {
      wrapHandler: async ({ next }) => next({ log: () => {} }),
    };

    createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [traceMw, logMw],
      processors: {
        foo: {
          attemptHandler: async ({ traceId, log, complete }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
            expectTypeOf(log).toEqualTypeOf<(msg: string) => void>();
            return complete(async () => ({ ok: true as const }));
          },
        },
      },
    });
  });
});

describe("handler ctx compile-time negatives", () => {
  it("rejects a wrong key in the injected ctx", () => {
    const _w: AttemptMiddleware<any, { good: string }> = {
      // @ts-expect-error — middleware declares { good: string }, passing { bad: ... } violates next()
      wrapHandler: async ({ next }) => next({ bad: "x" }),
    };
  });

  it("handler cannot use ctx keys not provided by middleware", () => {
    const w: AttemptMiddleware<any, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t" }),
    };
    createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [w],
      processors: {
        foo: {
          // @ts-expect-error — 'otherKey' not provided by any middleware
          attemptHandler: async ({ traceId, otherKey, complete }) => {
            void traceId;
            void otherKey;
            return complete(async () => ({ ok: true as const }));
          },
        },
      },
    });
  });
});
