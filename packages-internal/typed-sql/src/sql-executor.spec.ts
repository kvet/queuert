import { describe, expect, expectTypeOf, it } from "vitest";

import { batchStatementExecutor, createTypedSqlExecutor } from "./sql-executor.ts";
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

const rows = [{ id: "inv_1", total: 120 }];

type InvoiceRow = InferColumns<typeof selectInvoice.columns>;

describe("createTypedSqlExecutor", () => {
  it("returns the rows of a synchronous executor as a plain value", () => {
    const calls: unknown[] = [];
    const execute = createTypedSqlExecutor({
      executeStatement: (options: { txCtx?: TxCtx; sql: string; params: unknown[] }) => {
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
      executeStatement: async (_options: { txCtx?: TxCtx }) => rows,
    });

    const result = execute({ sql: selectInvoice, params: ["inv_1"] });

    expectTypeOf(result).toEqualTypeOf<Promise<InvoiceRow[]>>();
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toEqual(rows);
  });

  it("returns plain rows or a promise over an executor of either mode", async () => {
    const executor: {
      executeStatement: (options: { txCtx?: TxCtx }) => unknown[] | Promise<unknown[]>;
    } = { executeStatement: async () => rows };
    const execute = createTypedSqlExecutor(executor);

    const result = execute({ sql: selectInvoice, params: ["inv_1"] });

    expectTypeOf(result).toEqualTypeOf<InvoiceRow[] | Promise<InvoiceRow[]>>();
    expect(await result).toEqual(rows);
  });
});

describe("batchStatementExecutor", () => {
  it("sends one statement as a batch of one and returns its rows", async () => {
    const calls: unknown[] = [];
    const execute = createTypedSqlExecutor(
      batchStatementExecutor({
        executeStatements: async (options: { txCtx?: TxCtx; statements: unknown[] }) => {
          calls.push(options);
          return [rows];
        },
      }),
    );

    const result = execute({ txCtx: { tx: true }, sql: selectInvoice, params: ["inv_1"] });

    expectTypeOf(result).toEqualTypeOf<Promise<InvoiceRow[]>>();
    expect(await result).toEqual(rows);
    expect(calls).toEqual([
      {
        txCtx: { tx: true },
        statements: [
          {
            id: selectInvoice.id,
            sql: selectInvoice.sql,
            params: ["inv_1"],
            paramTypes: { 0: "string" },
            columnTypes: { id: "string", total: "number" },
            readOnly: true,
          },
        ],
      },
    ]);
  });
});
