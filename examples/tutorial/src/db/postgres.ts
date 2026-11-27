import { PGlite } from "@electric-sql/pglite";
import { createPgStateAdapter } from "@queuert/postgres";
import {
  type PgliteContext,
  createPgliteStateProvider,
} from "example-postgresql-state-pglite/provider";

export const openDatabase = async () => {
  const pglite = await PGlite.create();
  const stateProvider = createPgliteStateProvider({ pglite });
  const stateAdapter = createPgStateAdapter({ stateProvider });
  await stateAdapter.migrateToLatest();

  const sql =
    (txCtx?: PgliteContext) =>
    async <TRow = Record<string, unknown>>(
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<TRow[]> => {
      const text = strings.reduce((query, part, index) => `${query}$${index}${part}`);
      return (await (txCtx?.pglite ?? pglite).query<TRow>(text, values)).rows;
    };

  return {
    stateAdapter,
    sql,
    [Symbol.asyncDispose]: async () => {
      await stateAdapter[Symbol.asyncDispose]();
      await pglite.close();
    },
  };
};
