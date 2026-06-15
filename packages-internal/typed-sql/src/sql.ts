export type RuntimeType =
  | "string"
  | "number"
  | "boolean"
  | "uuid"
  | "json"
  | "array"
  | "jsonArray"
  | "string?"
  | "number?"
  | "boolean?"
  | "uuid?"
  | "json?"
  | "date?";

export type DataType<TRuntime extends RuntimeType = RuntimeType, TTs = unknown> = {
  readonly type: TRuntime;
  readonly $ts: TTs;
};

export type InferType<T> = T extends DataType<RuntimeType, infer U> ? U : never;

export type InferParams<T extends readonly DataType[]> = {
  readonly [K in keyof T]: InferType<T[K]>;
};

export type InferColumns<T extends Record<string, DataType>> = {
  [K in keyof T]: InferType<T[K]>;
};

const _string = { type: "string" } as DataType<"string", string>;
const _number = { type: "number" } as DataType<"number", number>;
const _boolean = { type: "boolean" } as DataType<"boolean", boolean>;
const _uuid = { type: "uuid" } as DataType<"uuid", string>;
const _json = { type: "json" } as DataType<"json">;
const _array = { type: "array" } as DataType<"array", string[]>;
const _jsonArray = { type: "jsonArray" } as DataType<"jsonArray", unknown[]>;
const _stringN = { type: "string?" } as DataType<"string?", string | null>;
const _numberN = { type: "number?" } as DataType<"number?", number | null>;
const _booleanN = { type: "boolean?" } as DataType<"boolean?", boolean | null>;
const _uuidN = { type: "uuid?" } as DataType<"uuid?", string | null>;
const _jsonN = { type: "json?" } as DataType<"json?">;
const _dateN = { type: "date?" } as DataType<"date?", string | null>;

export const t = {
  string: <T extends string = string>(): DataType<"string", T> => _string as DataType<"string", T>,
  number: <T extends number = number>(): DataType<"number", T> => _number as DataType<"number", T>,
  boolean: (): DataType<"boolean", boolean> => _boolean,
  uuid: (): DataType<"uuid", string> => _uuid,
  json: <T = unknown>(): DataType<"json", T> => _json as DataType<"json", T>,
  array: <T = string>(): DataType<"array", T[]> => _array as DataType<"array", T[]>,
  jsonArray: <T = unknown>(): DataType<"jsonArray", T[]> =>
    _jsonArray as DataType<"jsonArray", T[]>,
  "string?": <T extends string = string>(): DataType<"string?", T | null> =>
    _stringN as DataType<"string?", T | null>,
  "number?": (): DataType<"number?", number | null> => _numberN,
  "boolean?": (): DataType<"boolean?", boolean | null> => _booleanN,
  "uuid?": (): DataType<"uuid?", string | null> => _uuidN,
  "json?": <T = unknown>(): DataType<"json?", T | null> => _jsonN as DataType<"json?", T | null>,
  "date?": (): DataType<"date?", string | null> => _dateN,
};

export type TypedSqlTemplate<
  TParams extends readonly DataType[] = readonly DataType[],
  TColumns extends Record<string, DataType> = Record<string, DataType>,
> = {
  readonly id?: string;
  readonly sql: string;
  readonly readOnly: boolean;
  readonly params: TParams;
  readonly columns: TColumns;
};

declare const appliedBrand: unique symbol;

export type TypedSql<
  TParams extends readonly DataType[] = readonly DataType[],
  TColumns extends Record<string, DataType> = Record<string, DataType>,
> = TypedSqlTemplate<TParams, TColumns> & { readonly [appliedBrand]: true };

export const sql = <
  const TParams extends readonly DataType[],
  const TColumns extends Record<string, DataType>,
>(
  sqlString: string,
  types?: { id?: string; params?: TParams; columns?: TColumns; readOnly?: boolean },
): TypedSqlTemplate<TParams, TColumns> =>
  ({
    id: types?.id,
    sql: sqlString,
    readOnly: types?.readOnly ?? false,
    params: types?.params ?? ([] as unknown as TParams),
    columns: types?.columns ?? ({} as TColumns),
  }) as TypedSqlTemplate<TParams, TColumns>;

export const extractParamTypes = (params: readonly DataType[]): Record<number, RuntimeType> => {
  const result: Record<number, RuntimeType> = {};
  for (let i = 0; i < params.length; i++) {
    result[i] = params[i].type;
  }
  return result;
};

export const extractColumnTypes = (
  columns: Record<string, DataType>,
): Record<string, RuntimeType> => {
  const result: Record<string, RuntimeType> = {};
  for (const [key, value] of Object.entries(columns)) {
    result[key] = value.type;
  }
  return result;
};
