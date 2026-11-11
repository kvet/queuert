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

export type SqlExecutor<TTxContext> = {
  executeSql: (options: {
    txCtx?: TTxContext;
    id?: string;
    sql: string;
    params: unknown[];
    paramTypes: Record<number, RuntimeType>;
    columnTypes: Record<string, RuntimeType>;
    readOnly: boolean;
  }) => Promise<unknown[]>;
};

const SQL_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const validateSqlIdentifier = (value: string, name: string): void => {
  if (!SQL_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${name}: "${value}". Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ to prevent SQL injection.`,
    );
  }
};

export const createTypedSqlExecutor =
  <TTxContext>(executor: SqlExecutor<TTxContext>) =>
  async <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>({
    txCtx,
    sql: typedSql,
    params,
  }: {
    txCtx?: TTxContext;
    sql: TypedSql<TParams, TColumns>;
  } & (TParams extends readonly []
    ? { params?: undefined }
    : { params: [...InferParams<TParams>] })): Promise<InferColumns<TColumns>[]> =>
    executor.executeSql({
      txCtx,
      id: typedSql.id,
      sql: typedSql.sql,
      params: params ?? [],
      paramTypes: extractParamTypes(typedSql.params),
      columnTypes: extractColumnTypes(typedSql.columns),
      readOnly: typedSql.readOnly,
    }) as Promise<InferColumns<TColumns>[]>;

export const createTemplateExecutor =
  <TTxContext>(executor: SqlExecutor<TTxContext>, applyTemplate: TemplateApplier) =>
  async (txCtx: TTxContext, statement: TypedSqlTemplate<readonly []>): Promise<void> => {
    const applied = applyTemplate(statement);
    await executor.executeSql({
      txCtx,
      id: applied.id,
      sql: applied.sql,
      params: [],
      paramTypes: {},
      columnTypes: {},
      readOnly: applied.readOnly,
    });
  };
