import { describe, expect, expectTypeOf, it } from "vitest";

import { createTemplateExecutor, createTypedSqlExecutor } from "./sql-executor.ts";
import { type InferColumns, sql, t } from "./sql.ts";
import { createTemplateApplier } from "./template-applier.ts";

type TxCtx = { tx: true };

const applyTemplate = createTemplateApplier({ schema: "billing" });

const selectInvoice = applyTemplate(
  sql(/* sql */ `SELECT id, total FROM {{schema}}.invoice WHERE id = $1`, {
    params: [t.string()],
    columns: { id: t.string(), total: t.number() },
    readOnly: true,
  }),
);

const createInvoiceTable = sql(/* sql */ `CREATE TABLE {{schema}}.invoice (id text)`);

const rows = [{ id: "inv_1", total: 120 }];

type InvoiceRow = InferColumns<typeof selectInvoice.columns>;

describe("createTypedSqlExecutor", () => {
  it("returns the rows of a synchronous executor as a plain value", () => {
    const calls: unknown[] = [];
    const execute = createTypedSqlExecutor({
      executeSql: (options: { txCtx?: TxCtx; sql: string; params: unknown[] }) => {
        calls.push(options);
        return rows;
      },
    });

    const result = execute({ sql: selectInvoice, params: ["inv_1"] });

    expectTypeOf(result).toEqualTypeOf<InvoiceRow[]>();
    expect(result).toEqual(rows);
    expect(calls).toEqual([
      expect.objectContaining({
        sql: selectInvoice.sql,
        params: ["inv_1"],
        readOnly: true,
        columnTypes: { id: "string", total: "number" },
      }),
    ]);
  });

  it("returns the rows of an asynchronous executor as a promise", async () => {
    const execute = createTypedSqlExecutor({
      executeSql: async (_options: { txCtx?: TxCtx }) => rows,
    });

    const result = execute({ sql: selectInvoice, params: ["inv_1"] });

    expectTypeOf(result).toEqualTypeOf<Promise<InvoiceRow[]>>();
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual(rows);
  });
});

describe("createTemplateExecutor", () => {
  it("runs the applied template synchronously over a synchronous executor", () => {
    const statements: string[] = [];
    const execute = createTemplateExecutor(
      {
        executeSql: ({ sql: statement }: { txCtx?: TxCtx; sql: string }) => {
          statements.push(statement);
          return [];
        },
      },
      applyTemplate,
    );

    execute({ tx: true }, createInvoiceTable);

    expectTypeOf(execute).returns.toEqualTypeOf<void>();
    expect(statements).toEqual([`CREATE TABLE billing.invoice (id text)`]);
  });

  it("returns a promise over an asynchronous executor", async () => {
    const statements: string[] = [];
    const execute = createTemplateExecutor(
      {
        executeSql: async ({ sql: statement }: { txCtx?: TxCtx; sql: string }) => {
          statements.push(statement);
          return [];
        },
      },
      applyTemplate,
    );

    const result = execute({ tx: true }, createInvoiceTable);

    expectTypeOf(result).toEqualTypeOf<Promise<void>>();
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(statements).toEqual([`CREATE TABLE billing.invoice (id text)`]);
  });
});
