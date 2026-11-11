import { MikroORM } from "@mikro-orm/postgresql";
import {
  createPgStateProviderConformanceContext,
  pgStateProviderConformanceCases,
  type PgStateProviderConformanceContext,
} from "@queuert/postgres/conformance";
import { acquirePostgres, type AcquiredPostgres } from "@queuert/testcontainers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createMikroOrmPgStateProvider, type MikroOrmPgContext } from "./provider.ts";

let pg: AcquiredPostgres;
let orm: MikroORM;
let stateProvider: ReturnType<typeof createMikroOrmPgStateProvider>;

beforeAll(async () => {
  pg = await acquirePostgres("postgres:18", import.meta.url);
  orm = await MikroORM.init({
    entities: [],
    clientUrl: pg.connectionString,
    discovery: { warnWhenNoEntities: false },
  });
  stateProvider = createMikroOrmPgStateProvider({ orm });
}, 60_000);

afterAll(async () => {
  await orm.close();
  await pg[Symbol.asyncDispose]();
});

// #region conformance
describe("state-postgres-mikro-orm provider conformance", () => {
  let context: PgStateProviderConformanceContext;

  beforeAll(async () => {
    context = await createPgStateProviderConformanceContext({
      createStateProvider: async () => stateProvider,
      withNonTransactionContext: async (fn) => fn({ em: orm.em.fork() }),
      withSavepoint: async (txCtx, fn) =>
        (txCtx as MikroOrmPgContext).em.transactional(async (em) => fn({ em })),
    });
  });

  for (const conformanceCase of pgStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("state-postgres-mikro-orm transaction binding", () => {
  const callbacksOf = (em: MikroOrmPgContext["em"]) => ({
    onTransactionCommit: (callback: () => void) => {
      stateProvider.onTransactionCommit({ em }, callback);
    },
    onTransactionRollback: (callback: () => void) => {
      stateProvider.onTransactionRollback({ em }, callback);
    },
  });

  test("throws for a context outside a MikroORM transaction", () => {
    expect(() => {
      callbacksOf(orm.em.fork()).onTransactionCommit(() => {});
    }).toThrow("The context is not in a transaction opened through MikroORM");
  });

  test("runs rollback callbacks when the database answers the commit with a rollback", async () => {
    const events: string[] = [];

    await expect(
      stateProvider.withTransaction(async (txCtx) => {
        stateProvider.onTransactionCommit(txCtx, () => {
          events.push("commit");
        });
        stateProvider.onTransactionRollback(txCtx, () => {
          events.push("rollback");
        });
        await txCtx.em.execute("SELECT 1 FROM missing_table").catch(() => {});
      }),
    ).rejects.toThrow("Transaction was rolled back instead of committed");

    expect(events).toEqual(["rollback"]);
  });
});
