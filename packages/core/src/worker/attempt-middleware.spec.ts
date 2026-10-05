import { describe, expectTypeOf, it } from "vitest";

import { type Client, createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { withTransactionHooks } from "../transaction-hooks.js";
import { type AttemptMiddleware, type MergedAttemptHandlerCtx } from "./attempt-middleware.js";
import { createProcessors } from "./create-processors.js";

type Defs = {
  foo: { entry: true; input: { v: number }; output: { ok: true } };
};
const jobTypes = defineJobTypes<Defs>();

const stateAdapter = await createInProcessStateAdapter();
const client = await createClient({ stateAdapter, jobTypes });

type W1<C extends Record<string, unknown>> = AttemptMiddleware<any, C>;

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
          attemptHandler: async ({ traceId, log, finish }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
            expectTypeOf(log).toEqualTypeOf<(msg: string) => void>();
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: { ok: true as const } }),
              ),
            );
          },
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
          attemptHandler: async ({ traceId, log, finish }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
            expectTypeOf(log).toEqualTypeOf<(msg: string) => void>();
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: { ok: true as const } }),
              ),
            );
          },
        },
      },
    });
  });
});

describe("AttemptMiddleware accepts concrete (non-any) state adapters", () => {
  it("accepts an adapter with a non-empty txCtx as the TStateAdapter parameter", () => {
    type Tx = { db: { query: (sql: string) => Promise<unknown> } };
    type DbStateAdapter = StateAdapter<Tx, string>;

    expectTypeOf<AttemptMiddleware<DbStateAdapter>>().toBeObject();
    expectTypeOf<AttemptMiddleware<DbStateAdapter, { trace: string }>>().toBeObject();
  });

  it("merges ctx across a multi-element tuple of concrete-adapter middleware", () => {
    type Tx = { db: { query: (sql: string) => Promise<unknown> } };
    type DbStateAdapter = StateAdapter<Tx, string>;
    const dbClient = client as unknown as Client<Defs, DbStateAdapter>;
    const dbStateAdapter = stateAdapter as unknown as DbStateAdapter;

    const traceMw: AttemptMiddleware<DbStateAdapter, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t" }),
    };
    const tenantMw: AttemptMiddleware<DbStateAdapter, { tenant: string }> = {
      wrapHandler: async ({ job, next }) => {
        expectTypeOf(job.id).toEqualTypeOf<string>();
        return next({ tenant: "acme" });
      },
    };

    createProcessors({
      client: dbClient,
      jobTypes,
      attemptMiddleware: [traceMw, tenantMw],
      processors: {
        foo: {
          attemptHandler: async ({ traceId, tenant, finish }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
            expectTypeOf(tenant).toEqualTypeOf<string>();
            return withTransactionHooks(async (transactionHooks) =>
              dbStateAdapter.withTransaction(async (txCtx) => {
                expectTypeOf(txCtx.db).toEqualTypeOf<Tx["db"]>();
                return finish({ ...txCtx, transactionHooks, output: { ok: true as const } });
              }),
            );
          },
        },
      },
    });
  });

  it("merges ctx across a tuple mixing any- and concrete-adapter middleware", () => {
    type DbStateAdapter = StateAdapter<
      { db: { query: (sql: string) => Promise<unknown> } },
      string
    >;

    const agnosticMw: AttemptMiddleware<any, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t" }),
    };
    const concreteMw: AttemptMiddleware<DbStateAdapter, { log: (msg: string) => void }> = {
      wrapHandler: async ({ next }) => next({ log: () => {} }),
    };

    createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [agnosticMw, concreteMw],
      processors: {
        foo: {
          attemptHandler: async ({ traceId, log, finish }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
            expectTypeOf(log).toEqualTypeOf<(msg: string) => void>();
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: { ok: true as const } }),
              ),
            );
          },
        },
      },
    });
  });
});

describe("middleware must match the client's state adapter", () => {
  it("rejects middleware typed against a foreign adapter", () => {
    type PgJobId = string & { readonly brand: "pg" };
    type PgAdapter = StateAdapter<{ sql: (q: string) => Promise<void> }, PgJobId>;
    const foreignMw: AttemptMiddleware<PgAdapter, { tenant: string }> = {
      wrapHandler: async ({ job, next }) => {
        void (job.id satisfies PgJobId);
        return next({ tenant: "acme" });
      },
    };

    createProcessors({
      client,
      jobTypes,
      // @ts-expect-error — middleware is typed for an adapter with branded job ids but the
      // client is in-process; its wrapHandler would read `job.id` as the wrong type
      attemptMiddleware: [foreignMw],
      processors: {
        foo: {
          attemptHandler: async ({ finish }) =>
            withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: { ok: true as const } }),
              ),
            ),
        },
      },
    });
  });

  it("accepts adapter-agnostic middleware against any client", () => {
    const agnosticMw: AttemptMiddleware<any, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t" }),
    };

    createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [agnosticMw],
      processors: {
        foo: {
          attemptHandler: async ({ traceId, finish }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: { ok: true as const } }),
              ),
            );
          },
        },
      },
    });
  });
});

describe("wrapHandler result", () => {
  it("passes the handler's finish result through next", () => {
    type WrapHandler = NonNullable<AttemptMiddleware<any, { traceId: string }>["wrapHandler"]>;
    const wrapHandler = null as unknown as WrapHandler;
    type Instantiated = typeof wrapHandler<{ marker: 1 }>;
    expectTypeOf<ReturnType<Parameters<Instantiated>[0]["next"]>>().toEqualTypeOf<
      Promise<{ marker: 1 }>
    >();
    expectTypeOf<ReturnType<Instantiated>>().toEqualTypeOf<Promise<{ marker: 1 }>>();
  });

  it("exposes only wrapHandler", () => {
    expectTypeOf<keyof AttemptMiddleware<any>>().toEqualTypeOf<"wrapHandler">();
  });

  it("takes the state adapter and the handler ctx as its only type parameters", () => {
    // @ts-expect-error — AttemptMiddleware has two type parameters
    type TooMany = AttemptMiddleware<any, { a: 1 }, { b: 2 }>;
    expectTypeOf<TooMany>().toBeAny();
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
          attemptHandler: async ({ traceId, otherKey, finish }) => {
            void traceId;
            void otherKey;
            return withTransactionHooks(async (transactionHooks) =>
              stateAdapter.withTransaction(async (txCtx) =>
                finish({ ...txCtx, transactionHooks, output: { ok: true as const } }),
              ),
            );
          },
        },
      },
    });
  });
});
