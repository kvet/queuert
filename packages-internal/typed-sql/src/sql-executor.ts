import type { MaybePromise, ModeResult, ResultModeOf } from "@queuert/sync-async";

import {
  type DataType,
  type InferColumns,
  type InferParams,
  type RuntimeType,
  type TypedSql,
  extractColumnTypes,
  extractParamTypes,
} from "./sql.ts";

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const validateSqlIdentifier = (value: string, name: string): void => {
  if (!SQL_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: "${value}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ to prevent SQL injection.`,
    );
  }
};

export type SqlStatement = {
  id?: string;
  sql: string;
  params: unknown[];
  paramTypes: Record<number, RuntimeType>;
  columnTypes: Record<string, RuntimeType>;
  readOnly: boolean;
};

export const toSqlStatement = (
  typedSql: TypedSql,
  params: readonly unknown[] = [],
): SqlStatement => ({
  id: typedSql.id,
  sql: typedSql.sql,
  params: params as unknown[],
  paramTypes: extractParamTypes(typedSql.params),
  columnTypes: extractColumnTypes(typedSql.columns),
  readOnly: typedSql.readOnly,
});

export const batchStatementExecutor = <TTxContext>(executor: {
  executeStatements(options: {
    txCtx?: TTxContext;
    statements: SqlStatement[];
  }): Promise<unknown[][]>;
}): {
  executeStatement: (options: { txCtx?: TTxContext } & SqlStatement) => Promise<unknown[]>;
} => ({
  executeStatement: async ({ txCtx, ...statement }) => {
    const [rows] = await executor.executeStatements({ txCtx, statements: [statement] });
    return rows;
  },
});

export const createTypedSqlExecutor =
  <
    TExecutor extends {
      executeStatement(options: { txCtx?: any } & SqlStatement): MaybePromise<unknown[]>;
    },
  >(
    executor: TExecutor,
  ) =>
  <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>({
    txCtx,
    sql: typedSql,
    params,
  }: {
    txCtx?: Parameters<TExecutor["executeStatement"]>[0]["txCtx"];
    sql: TypedSql<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): ModeResult<
    ResultModeOf<ReturnType<TExecutor["executeStatement"]>>,
    InferColumns<TColumns>[]
  > =>
    executor.executeStatement({ txCtx, ...toSqlStatement(typedSql, params) }) as ModeResult<
      ResultModeOf<ReturnType<TExecutor["executeStatement"]>>,
      InferColumns<TColumns>[]
    >;
