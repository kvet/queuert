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

/**
 * A typed SQL statement that may still contain unresolved `{{...}}` template
 * placeholders. Produced by {@link sql}. Cannot be executed directly — pass
 * through {@link createTemplateApplier} to obtain an executable
 * {@link TypedSql}.
 */
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

/**
 * A {@link TypedSqlTemplate} with all `{{...}}` placeholders resolved.
 * Brand-only distinct from `TypedSqlTemplate`; the only way to obtain one is
 * through {@link createTemplateApplier}. Execution helpers accept this type so
 * a raw template can never be sent to the database.
 */
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

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export type MigrationStatement = {
  sql: TypedSqlTemplate;
};

/**
 * A schema migration applied once per database. Identified by `name` (the dedup
 * key recorded in the migrations table) and a list of SQL `statements` run in
 * order.
 *
 * `transactional` controls whether the statements + the migration record run
 * inside a single transaction:
 * - `true` — statements + record are atomic; on failure the migration is
 *   retried from scratch on next startup. Use this for almost all migrations.
 * - `false` — statements run outside any transaction; only the migration
 *   record is written transactionally afterwards. Use only when the DB forbids
 *   transactional execution (e.g., Postgres `CREATE INDEX CONCURRENTLY`).
 *   Every statement must be idempotent because a partial failure leaves rows
 *   half-applied and the migration is retried as-is.
 */
export type Migration = {
  name: string;
  statements: MigrationStatement[];
  transactional: boolean;
};

// ---------------------------------------------------------------------------
// Template applier
// ---------------------------------------------------------------------------

// FNV-1a 32-bit. Not cryptographic — just a stable, dependency-free way to
// fold a resolved SQL string into a short suffix that disambiguates `id`s
// across different template variants (e.g. table prefixes) within one process.
const fnv1aHex = (input: string): string => {
  const len = input.length;
  const tail = len & 3;
  const end = len - tail;
  let hash = 0x811c9dc5;
  let i = 0;
  for (; i < end; i += 4) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193);
    hash = Math.imul(hash ^ input.charCodeAt(i + 1), 0x01000193);
    hash = Math.imul(hash ^ input.charCodeAt(i + 2), 0x01000193);
    hash = Math.imul(hash ^ input.charCodeAt(i + 3), 0x01000193);
  }
  for (; i < len; i++) {
    hash = Math.imul(hash ^ input.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const createTemplateApplier = (
  variables: Record<string, string>,
  functions?: Record<string, (...args: string[]) => string>,
): (<TParams extends readonly DataType[], TColumns extends Record<string, DataType>>(
  typedSql: TypedSqlTemplate<TParams, TColumns>,
) => TypedSql<TParams, TColumns>) => {
  const variableEntries = Object.entries(variables);
  const functionEntries = functions ? Object.entries(functions) : [];

  return <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>(
    typedSql: TypedSqlTemplate<TParams, TColumns>,
  ): TypedSql<TParams, TColumns> => {
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
    const resolvedId =
      typedSql.id !== undefined ? `${typedSql.id}@${fnv1aHex(resolvedSql)}` : undefined;
    return { ...typedSql, id: resolvedId, sql: resolvedSql } as TypedSql<TParams, TColumns>;
  };
};

/**
 * Caches resolved templates keyed by a caller-supplied string, so a static
 * query is resolved (variable substitution + id hashing) only once. Callers
 * pass a stable key for static queries; dynamic queries should bypass the cache
 * and resolve inline so the cache cannot grow unbounded.
 */
export const createTemplateCache = (): {
  getOrCompute: <TParams extends readonly DataType[], TColumns extends Record<string, DataType>>(
    key: string,
    compute: () => TypedSql<TParams, TColumns>,
  ) => TypedSql<TParams, TColumns>;
} => {
  const cache = new Map<string, TypedSql<any, any>>();
  return {
    getOrCompute: (key, compute) => {
      let resolved = cache.get(key);
      if (resolved === undefined) {
        resolved = compute();
        cache.set(key, resolved);
      }
      return resolved;
    },
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
  runInTransaction,
  getAppliedMigrationNames,
  executeMigrationStatements,
  recordMigration,
}: {
  migrations: Migration[];
  runInTransaction: <T>(fn: (txCtx: TTxContext) => Promise<T>) => Promise<T>;
  getAppliedMigrationNames: (txCtx: TTxContext | undefined) => Promise<string[]>;
  executeMigrationStatements: (
    txCtx: TTxContext | undefined,
    migration: Migration,
  ) => Promise<void>;
  recordMigration: (txCtx: TTxContext | undefined, name: string) => Promise<void>;
}): Promise<MigrationResult> => {
  const migrationNames = new Set(migrations.map((m) => m.name));

  const previouslyApplied = await runInTransaction(getAppliedMigrationNames);
  const previouslyAppliedSet = new Set(previouslyApplied);

  const skipped = previouslyApplied.filter((name) => migrationNames.has(name));
  const unrecognized = previouslyApplied.filter((name) => !migrationNames.has(name));
  const pending = migrations.filter((m) => !previouslyAppliedSet.has(m.name));
  const applied: string[] = [];

  for (const migration of pending) {
    if (migration.transactional) {
      await runInTransaction(async (txCtx) => {
        await executeMigrationStatements(txCtx, migration);
        await recordMigration(txCtx, migration.name);
      });
    } else {
      await executeMigrationStatements(undefined, migration);
      await runInTransaction(async (txCtx) => recordMigration(txCtx, migration.name));
    }
    applied.push(migration.name);
  }

  return { skipped, applied, unrecognized };
};
