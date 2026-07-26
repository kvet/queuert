import { describe, expectTypeOf, it } from "vitest";

import { type Client, createClient } from "../client.js";
import { defineJobTypes } from "../entities/define-job-types.js";
import { createInProcessStateAdapter } from "../state-adapter/state-adapter.in-process.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import {
  type AttemptMiddleware,
  type MergedAttemptHandlerCtx,
  type MergedCompleteCtx,
  type MergedExecuteCtx,
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
type W4<
  H extends Record<string, unknown>,
  P extends Record<string, unknown>,
  E extends Record<string, unknown>,
  C extends Record<string, unknown>,
> = AttemptMiddleware<any, H, P, E, C>;

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

  it("MergedPrepareCtx / MergedExecuteCtx / MergedCompleteCtx pick only their phase", () => {
    expectTypeOf<
      MergedPrepareCtx<readonly [W4<{ h: 1 }, { p: 2 }, { e: 3 }, { c: 4 }>]>
    >().toEqualTypeOf<{ p: 2 }>();
    expectTypeOf<
      MergedExecuteCtx<readonly [W4<{ h: 1 }, { p: 2 }, { e: 3 }, { c: 4 }>]>
    >().toEqualTypeOf<{ e: 3 }>();
    expectTypeOf<
      MergedCompleteCtx<readonly [W4<{ h: 1 }, { p: 2 }, { e: 3 }, { c: 4 }>]>
    >().toEqualTypeOf<{ c: 4 }>();
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
    const w: AttemptMiddleware<any, Record<string, never>, { tag: string }> = {
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

  it("executeCallback options include execute ctx alongside transactionHooks & txCtx", () => {
    const w: AttemptMiddleware<
      any,
      Record<string, never>,
      Record<string, never>,
      { meter: (name: string) => void }
    > = {
      wrapExecute: async ({ next }) => next({ meter: () => {} }),
    };

    createProcessors({
      client,
      jobTypes,
      attemptMiddleware: [w],
      processors: {
        foo: {
          attemptHandler: async ({ execute, complete }) => {
            await execute(async ({ meter, transactionHooks: _t }) => {
              expectTypeOf(meter).toEqualTypeOf<(name: string) => void>();
            });
            return complete(async () => ({ ok: true as const }));
          },
        },
      },
    });
  });

  it("completeCallback options include complete ctx alongside continueWith & txCtx", () => {
    const w: AttemptMiddleware<
      any,
      Record<string, never>,
      Record<string, never>,
      Record<string, never>,
      { audit: (evt: string) => void }
    > = {
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

describe("AttemptMiddleware accepts concrete (non-any) state adapters", () => {
  it("accepts an adapter with a non-empty txCtx as the TStateAdapter parameter", () => {
    type Tx = { db: { query: (sql: string) => Promise<unknown> } };
    type DbStateAdapter = StateAdapter<Tx, string>;

    expectTypeOf<AttemptMiddleware<DbStateAdapter>>().toBeObject();
    expectTypeOf<AttemptMiddleware<DbStateAdapter, { trace: string }>>().toBeObject();
  });

  it("wrapPrepare/wrapExecute/wrapComplete receive the adapter's txCtx fields", () => {
    type Tx = { db: { query: (sql: string) => Promise<unknown> } };
    type DbStateAdapter = StateAdapter<Tx, string>;

    const mwPrepare: AttemptMiddleware<DbStateAdapter> = {
      wrapPrepare: async ({ db, next }) => {
        expectTypeOf(db).toEqualTypeOf<Tx["db"]>();
        return next({});
      },
    };
    const mwExecute: AttemptMiddleware<DbStateAdapter> = {
      wrapExecute: async ({ db, next }) => {
        expectTypeOf(db).toEqualTypeOf<Tx["db"]>();
        return next({});
      },
    };
    const mwComplete: AttemptMiddleware<DbStateAdapter> = {
      wrapComplete: async ({ db, transactionHooks: _t, next }) => {
        expectTypeOf(db).toEqualTypeOf<Tx["db"]>();
        return next({});
      },
    };
    void mwPrepare;
    void mwExecute;
    void mwComplete;
  });

  /*
   * Typed against `DbStateAdapter`, not `typeof stateAdapter`: the in-process
   * adapter's txCtx has only optional properties, so it stays assignable to a
   * bare-`any` wildcard and cannot reproduce the ctx collapse this guards.
   * `createProcessors` now requires the middleware adapter to match the
   * client's, so the client is retyped to the same alias — the call only stamps
   * objects, so the in-process instance backing it is never touched.
   */
  it("merges ctx across a multi-element tuple of concrete-adapter middleware", () => {
    type Tx = { db: { query: (sql: string) => Promise<unknown> } };
    type DbStateAdapter = StateAdapter<Tx, string>;
    const dbClient = client as unknown as Client<Defs, DbStateAdapter>;

    const traceMw: AttemptMiddleware<DbStateAdapter, { traceId: string }> = {
      wrapHandler: async ({ next }) => next({ traceId: "t" }),
    };
    const prepareMw: AttemptMiddleware<
      DbStateAdapter,
      Record<string, never>,
      { tenant: string }
    > = {
      wrapPrepare: async ({ db, next }) => {
        expectTypeOf(db).toEqualTypeOf<Tx["db"]>();
        return next({ tenant: "acme" });
      },
    };
    const outboxMw: AttemptMiddleware<
      DbStateAdapter,
      Record<string, never>,
      Record<string, never>,
      { emit: (evt: string) => void },
      { emit: (evt: string) => void }
    > = {
      wrapExecute: async ({ db, next }) => {
        expectTypeOf(db).toEqualTypeOf<Tx["db"]>();
        return next({ emit: () => {} });
      },
      wrapComplete: async ({ db, next }) => {
        expectTypeOf(db).toEqualTypeOf<Tx["db"]>();
        return next({ emit: () => {} });
      },
    };

    createProcessors({
      client: dbClient,
      jobTypes,
      attemptMiddleware: [traceMw, prepareMw, outboxMw],
      processors: {
        foo: {
          attemptHandler: async ({ traceId, prepare, execute, complete }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
            await prepare({ mode: "staged" }, async ({ tenant }) => {
              expectTypeOf(tenant).toEqualTypeOf<string>();
            });
            await execute(async ({ emit }) => {
              expectTypeOf(emit).toEqualTypeOf<(evt: string) => void>();
            });
            return complete(async ({ emit }) => {
              expectTypeOf(emit).toEqualTypeOf<(evt: string) => void>();
              return { ok: true as const };
            });
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

describe("middleware must match the client's state adapter", () => {
  it("rejects middleware typed against a foreign adapter", () => {
    type PgAdapter = StateAdapter<{ sql: (q: string) => Promise<void> }, string>;
    const foreignMw: AttemptMiddleware<PgAdapter, Record<string, never>, { tenant: string }> = {
      wrapPrepare: async ({ sql, next }) => {
        void sql;
        return next({ tenant: "acme" });
      },
    };

    createProcessors({
      client,
      jobTypes,
      // @ts-expect-error — middleware is typed for a Postgres-shaped adapter but
      // the client is in-process; its hooks would destructure an undefined `sql`
      attemptMiddleware: [foreignMw],
      processors: {
        foo: { attemptHandler: async ({ complete }) => complete(async () => ({ ok: true })) },
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
          attemptHandler: async ({ traceId, complete }) => {
            expectTypeOf(traceId).toEqualTypeOf<string>();
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
