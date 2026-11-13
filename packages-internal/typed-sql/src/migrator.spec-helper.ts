import { type MaybePromise, type Mode, isPromise } from "@queuert/helpers/maybe-promise";
import { type Modal, modal } from "@queuert/helpers/modal";
import { step } from "@queuert/helpers/steps";
import { expect } from "vitest";

import type { MigrationLockOptions } from "./migration-lock.ts";
import {
  type Migration,
  type MigrationResult,
  type MigrationScript,
  type MigrationStore,
  createMigrator,
  createSyncMigrator,
} from "./migrator.ts";

export type TxCtx = { tx: true };

export type { Mode };

export const modes: Mode[] = ["async", "sync"];

export type RunEvent =
  | { kind: "begin" }
  | { kind: "commit" }
  | { kind: "rollback" }
  | { kind: "statement"; sql: string; inTx: boolean }
  | { kind: "record"; name: string; inTx: boolean }
  | { kind: "unrecord"; name: string; inTx: boolean }
  | { kind: "script"; name: string }
  | { kind: "acquire"; acquired: boolean }
  | { kind: "extend"; extended: boolean | "reject" }
  | { kind: "release" };

export const createMigratorHarness = (
  mode: Mode,
  options: { initiallyApplied?: string[]; failStatementsFor?: string } = {},
) => {
  const sync = mode === "sync";
  const events: RunEvent[] = [];
  const applied = new Set<string>(options.initiallyApplied ?? []);
  const hooks: {
    beforeStatement: (statement: string) => MaybePromise<void>;
    afterStatement: (statement: string) => MaybePromise<void>;
  } = {
    beforeStatement: () => {},
    afterStatement: () => {},
  };

  const inMode = <TArgs extends unknown[], TResult>(
    body: Modal<TArgs, TResult>,
  ): ((...args: TArgs) => MaybePromise<TResult>) => (sync ? body.sync : body.async);

  const settle = <T>(fn: () => T): MaybePromise<T> => (sync ? fn() : (async () => fn())());

  const runStatement = inMode(
    modal(function* (statement: string, txCtx: TxCtx | undefined) {
      yield* step(hooks.beforeStatement(statement));
      events.push({ kind: "statement", sql: statement, inTx: txCtx !== undefined });
      if (options.failStatementsFor === statement) {
        throw new Error(`statement failed for ${statement}`);
      }
      yield* step(hooks.afterStatement(statement));
    }),
  );

  const runInTransaction = inMode(
    modal(function* (fn: (txCtx: TxCtx) => MaybePromise<unknown>) {
      events.push({ kind: "begin" });
      try {
        const result = yield* step(fn({ tx: true }));
        events.push({ kind: "commit" });
        return result;
      } catch (err) {
        events.push({ kind: "rollback" });
        throw err;
      }
    }),
  );

  const tx = (name: string): Migration<TxCtx, Mode> => ({
    name,
    up: (txCtx) => runStatement(name, txCtx),
    down: (txCtx) => runStatement(`undo ${name}`, txCtx),
  });
  const nonTx = (name: string): Migration<TxCtx, Mode> => ({
    name,
    type: "non-transactional",
    up: () => runStatement(name, undefined),
    down: () => runStatement(`undo ${name}`, undefined),
  });

  const store: MigrationStore<TxCtx, Mode> = {
    runInTransaction: <T>(fn: (txCtx: TxCtx) => MaybePromise<T>) =>
      runInTransaction(fn) as MaybePromise<T>,
    getAppliedMigrationNames: () => settle(() => [...applied]),
    recordMigration: (txCtx, name) =>
      settle(() => {
        events.push({ kind: "record", name, inTx: txCtx !== undefined });
        applied.add(name);
      }),
    unrecordMigration: (txCtx, name) =>
      settle(() => {
        events.push({ kind: "unrecord", name, inTx: txCtx !== undefined });
        applied.delete(name);
      }),
  };

  return { events, applied, store, hooks, tx, nonTx, settle };
};

export const createMigratorInMode = (
  mode: Mode,
  options: {
    migrations: Migration<TxCtx, Mode>[];
    store: MigrationStore<TxCtx, Mode>;
    lock?: MigrationLockOptions;
    before?: MigrationScript<Mode>;
    after?: MigrationScript<Mode>;
  },
): {
  migrateToLatest: () => MaybePromise<MigrationResult>;
  migrateTo: (name: string | null) => MaybePromise<MigrationResult>;
} => {
  const migrator =
    mode === "sync"
      ? createSyncMigrator(
          options as {
            migrations: Migration<TxCtx, "sync">[];
            store: MigrationStore<TxCtx, "sync">;
            before?: MigrationScript<"sync">;
            after?: MigrationScript<"sync">;
          },
        )
      : createMigrator(
          options as {
            migrations: Migration<TxCtx>[];
            store: MigrationStore<TxCtx>;
            lock?: MigrationLockOptions;
            before?: MigrationScript;
            after?: MigrationScript;
          },
        );
  const inMode = (result: MaybePromise<MigrationResult>): MaybePromise<MigrationResult> => {
    expect(isPromise(result)).toBe(mode === "async");
    return result;
  };
  return {
    migrateToLatest: () => inMode(migrator.migrateToLatest()),
    migrateTo: (name) => inMode(migrator.migrateTo(name)),
  };
};

export const createLockedMigratorHarness = (
  options: Parameters<typeof createMigratorHarness>[1] & {
    acquireResults?: boolean[];
    extendResults?: (boolean | "reject")[];
  } = {},
) => {
  const harness = createMigratorHarness("async", options);
  const { events } = harness;
  let acquireCursor = 0;
  let extendCursor = 0;
  const store: MigrationStore<TxCtx> = {
    ...(harness.store as MigrationStore<TxCtx>),
    acquireMigrationLock: async () => {
      const results = options.acquireResults ?? [true];
      const acquired = results[Math.min(acquireCursor, results.length - 1)];
      acquireCursor += 1;
      events.push({ kind: "acquire", acquired });
      return acquired;
    },
    extendMigrationLock: async () => {
      const results = options.extendResults ?? [true];
      const extended = results[Math.min(extendCursor, results.length - 1)];
      extendCursor += 1;
      events.push({ kind: "extend", extended });
      if (extended === "reject") throw new Error("heartbeat connection failed");
      return extended;
    },
    releaseMigrationLock: async () => {
      events.push({ kind: "release" });
    },
  };
  return {
    ...harness,
    store,
    tx: harness.tx as (name: string) => Migration<TxCtx>,
    nonTx: harness.nonTx as (name: string) => Migration<TxCtx>,
  };
};

export const A = "001_alpha";
export const B = "002_bravo";
export const C = "003_charlie";
export const BOOM = "004_boom";
