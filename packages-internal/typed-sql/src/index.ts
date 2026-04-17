// ---------------------------------------------------------------------------
// DataType — branded type descriptor carrying both runtime and compile-time info
// ---------------------------------------------------------------------------

/** Runtime type tag used by providers for serialization/deserialization. */
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

/** Branded type: `.type` for runtime, `.$ts` phantom for compile-time inference. */
export type DataType<TRuntime extends RuntimeType = RuntimeType, TTs = unknown> = {
  readonly type: TRuntime;
  readonly $ts: TTs;
};

/** Extract the TS type from a DataType. */
export type InferType<T> = T extends DataType<RuntimeType, infer U> ? U : never;

/** Extract TS types from a params tuple. */
export type InferParams<T extends readonly DataType[]> = {
  readonly [K in keyof T]: InferType<T[K]>;
};

/** Extract TS types from a columns record. */
export type InferColumns<T extends Record<string, DataType>> = {
  [K in keyof T]: InferType<T[K]>;
};

// ---------------------------------------------------------------------------
// DataType factory helpers
// ---------------------------------------------------------------------------

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

// TODO?: runtime validation of provided types
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

// ---------------------------------------------------------------------------
// TypedSql
// ---------------------------------------------------------------------------

export type TypedSql<
  TParams extends readonly DataType[] = readonly DataType[],
  TColumns extends Record<string, DataType> = Record<string, DataType>,
> = {
  readonly sql: string;
  readonly returns: boolean;
  readonly params: TParams;
  readonly columns: TColumns;
};

export const sql = <
  const TParams extends readonly DataType[],
  const TColumns extends Record<string, DataType>,
>(
  sqlString: string,
  returns: boolean,
  types?: { params?: TParams; columns?: TColumns },
): TypedSql<TParams, TColumns> =>
  ({
    sql: sqlString,
    returns,
    params: types?.params ?? ([] as unknown as TParams),
    columns: types?.columns ?? ({} as TColumns),
  }) as TypedSql<TParams, TColumns>;

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export type MigrationStatement = {
  sql: TypedSql;
};

export type Migration = {
  name: string;
  statements: MigrationStatement[];
};

// ---------------------------------------------------------------------------
// Template applier
// ---------------------------------------------------------------------------

export const createTemplateApplier = (
  variables: Record<string, string>,
  functions?: Record<string, (...args: string[]) => string>,
): (<TParams extends readonly DataType[], TColumns extends Record<string, DataType>>(
  typedSql: TypedSql<TParams, TColumns>,
) => TypedSql<TParams, TColumns>) => {
  const cache = new WeakMap<TypedSql<any, any>, TypedSql<any, any>>();
  const variableEntries = Object.entries(variables);
  const functionEntries = functions ? Object.entries(functions) : [];

  return <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>(
    typedSql: TypedSql<TParams, TColumns>,
  ): TypedSql<TParams, TColumns> => {
    let cached = cache.get(typedSql);
    if (!cached) {
      let resolvedSql = typedSql.sql;
      for (const [key, value] of variableEntries) {
        resolvedSql = resolvedSql.replaceAll(`{{${key}}}`, value);
      }
      for (const [name, fn] of functionEntries) {
        const pattern = new RegExp(`\\{\\{${name}:([^}]+)\\}\\}`, "g");
        resolvedSql = resolvedSql.replace(pattern, (_, argsStr: string) => {
          const args = argsStr.split(":");
          return fn(...args);
        });
      }
      cached = { ...typedSql, sql: resolvedSql };
      cache.set(typedSql, cached);
    }
    return cached as TypedSql<TParams, TColumns>;
  };
};

// ---------------------------------------------------------------------------
// Runtime type extraction helpers
// ---------------------------------------------------------------------------

/** Extract runtime types from a params tuple (for provider use). */
export const extractParamTypes = (params: readonly DataType[]): Record<number, RuntimeType> => {
  const result: Record<number, RuntimeType> = {};
  for (let i = 0; i < params.length; i++) {
    result[i] = params[i].type;
  }
  return result;
};

/** Extract runtime types from a columns record (for provider use). */
export const extractColumnTypes = (
  columns: Record<string, DataType>,
): Record<string, RuntimeType> => {
  const result: Record<string, RuntimeType> = {};
  for (const [key, value] of Object.entries(columns)) {
    result[key] = value.type;
  }
  return result;
};

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

/** Result of running {@link executeMigrations}. Lists which migrations were applied, skipped, or unrecognized. */
export type MigrationResult = {
  /** Migrations already applied in a previous run. */
  skipped: string[];
  /** Migrations applied during this run. */
  applied: string[];
  /** Migration names found in the database that don't match any known migration. */
  unrecognized: string[];
};

export const executeMigrations = async <TTxContext>({
  migrations,
  getAppliedMigrationNames,
  executeMigrationStatements,
  recordMigration,
}: {
  migrations: Migration[];
  getAppliedMigrationNames: (txCtx: TTxContext) => Promise<string[]>;
  executeMigrationStatements: (txCtx: TTxContext, migration: Migration) => Promise<void>;
  recordMigration: (txCtx: TTxContext, name: string) => Promise<void>;
}): Promise<(txCtx: TTxContext) => Promise<MigrationResult>> => {
  const migrationNames = new Set(migrations.map((m) => m.name));

  return async (txCtx: TTxContext): Promise<MigrationResult> => {
    const previouslyApplied = await getAppliedMigrationNames(txCtx);
    const previouslyAppliedSet = new Set(previouslyApplied);

    const skipped = previouslyApplied.filter((name) => migrationNames.has(name));
    const unrecognized = previouslyApplied.filter((name) => !migrationNames.has(name));
    const pending = migrations.filter((m) => !previouslyAppliedSet.has(m.name));
    const applied: string[] = [];

    for (const migration of pending) {
      await executeMigrationStatements(txCtx, migration);
      await recordMigration(txCtx, migration.name);
      applied.push(migration.name);
    }

    return { skipped, applied, unrecognized };
  };
};
