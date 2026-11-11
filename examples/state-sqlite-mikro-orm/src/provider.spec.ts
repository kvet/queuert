import { MikroORM } from "@mikro-orm/sqlite";
import {
  createSqliteStateProviderConformanceContext,
  type SqliteStateProviderConformanceContext,
  sqliteStateProviderConformanceCases,
} from "@queuert/sqlite/conformance";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createMikroOrmSqliteStateProvider, type MikroOrmSqliteContext } from "./provider.ts";

let orm: MikroORM;
let stateProvider: ReturnType<typeof createMikroOrmSqliteStateProvider>;

beforeAll(async () => {
  orm = await MikroORM.init({
    entities: [],
    dbName: ":memory:",
    discovery: { warnWhenNoEntities: false },
  });
  stateProvider = createMikroOrmSqliteStateProvider({ orm });
});

afterAll(async () => {
  await orm.close();
});

// #region conformance
describe("state-sqlite-mikro-orm provider conformance", () => {
  let context: SqliteStateProviderConformanceContext;

  beforeAll(async () => {
    context = await createSqliteStateProviderConformanceContext({
      createStateProvider: async () => stateProvider,
      withNonTransactionContext: async (fn) => fn({ em: orm.em.fork() }),
      withSavepoint: async (txCtx, fn) =>
        (txCtx as MikroOrmSqliteContext).em.transactional(async (em) => fn({ em })),
    });
  });

  for (const conformanceCase of sqliteStateProviderConformanceCases) {
    test(conformanceCase.title, async () => {
      await conformanceCase.run(context);
    });
  }
});
// #endregion

describe("state-sqlite-mikro-orm transaction binding", () => {
  const callbacksOf = (em: MikroOrmSqliteContext["em"]) => ({
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
});
