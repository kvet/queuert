import { type MaybePromise, andThen } from "@queuert/helpers/maybe-promise";

import {
  type DataType,
  type InferColumns,
  type InferParams,
  type RuntimeType,
  type TypedSql,
  type TypedSqlTemplate,
  extractColumnTypes,
  extractParamTypes,
} from "./sql.ts";
import type { TemplateApplier } from "./template-applier.ts";

type SqlExecutorOptions<TTxContext> = {
  txCtx?: TTxContext;
  id?: string;
  sql: string;
  params: unknown[];
  paramTypes: Record<number, RuntimeType>;
  columnTypes: Record<string, RuntimeType>;
  readOnly: boolean;
};

type AnySqlExecutor<TTxContext, TRows extends MaybePromise<unknown[]>> = {
  executeSql: (options: SqlExecutorOptions<TTxContext>) => TRows;
};

type ResultLike<TRows, T> = TRows extends Promise<unknown> ? Promise<T> : T;

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const validateSqlIdentifier = (value: string, name: string): void => {
  if (!SQL_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: "${value}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ to prevent SQL injection.`,
    );
  }
};

export const createTypedSqlExecutor =
  <TTxContext, TRows extends MaybePromise<unknown[]>>(
    executor: AnySqlExecutor<TTxContext, TRows>,
  ) =>
  <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>({
    txCtx,
    sql: typedSql,
    params,
  }: {
    txCtx?: TTxContext;
    sql: TypedSql<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): ResultLike<TRows, InferColumns<TColumns>[]> =>
    executor.executeSql({
      txCtx,
      id: typedSql.id,
      sql: typedSql.sql,
      params: params ?? [],
      paramTypes: extractParamTypes(typedSql.params),
      columnTypes: extractColumnTypes(typedSql.columns),
      readOnly: typedSql.readOnly,
    }) as ResultLike<TRows, InferColumns<TColumns>[]>;

export const createTemplateExecutor =
  <TTxContext, TRows extends MaybePromise<unknown[]>>(
    executor: AnySqlExecutor<TTxContext, TRows>,
    applyTemplate: TemplateApplier,
  ) =>
  (txCtx: TTxContext, statement: TypedSqlTemplate<readonly []>): ResultLike<TRows, void> => {
    const applied = applyTemplate(statement);
    return andThen(
      executor.executeSql({
        txCtx,
        id: applied.id,
        sql: applied.sql,
        params: [],
        paramTypes: {},
        columnTypes: {},
        readOnly: applied.readOnly,
      }),
      () => undefined,
    ) as ResultLike<TRows, void>;
  };
