import type { MaybePromise, ResultModeOf, ModeResult } from "@queuert/sync-async";

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

export const createTypedSqlExecutor =
  <
    TExecutor extends {
      executeSql(options: {
        txCtx?: any;
        id?: string;
        sql: string;
        params: unknown[];
        paramTypes: Record<number, RuntimeType>;
        columnTypes: Record<string, RuntimeType>;
        readOnly: boolean;
      }): MaybePromise<unknown[]>;
    },
  >(
    executor: TExecutor,
  ) =>
  <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>({
    txCtx,
    sql: typedSql,
    params,
  }: {
    txCtx?: Parameters<TExecutor["executeSql"]>[0]["txCtx"];
    sql: TypedSql<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): ModeResult<
    ResultModeOf<ReturnType<TExecutor["executeSql"]>>,
    InferColumns<TColumns>[]
  > =>
    executor.executeSql({
      txCtx,
      id: typedSql.id,
      sql: typedSql.sql,
      params: params ?? [],
      paramTypes: extractParamTypes(typedSql.params),
      columnTypes: extractColumnTypes(typedSql.columns),
      readOnly: typedSql.readOnly,
    }) as ModeResult<ResultModeOf<ReturnType<TExecutor["executeSql"]>>, InferColumns<TColumns>[]>;
