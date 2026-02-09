export type NamedParameter<TParamName extends string, TParamValue> = {
  readonly $paramName: TParamName;
  readonly $paramValue: TParamValue;
};

type UnwrapNamedParameter<T> = T extends NamedParameter<string, infer V> ? V : T;

export type UnwrapNamedParameters<T extends readonly unknown[]> = {
  -readonly [K in keyof T]: UnwrapNamedParameter<T[K]>;
};

export type TypedSql<
  TParams extends
    | readonly [NamedParameter<string, unknown>, ...NamedParameter<string, unknown>[]]
    | readonly [],
  TResult,
> = {
  readonly sql: string;
  readonly returns: boolean;
  readonly $paramsType: TParams;
  readonly $resultType: TResult;
};

export const sql = <
  TParams extends
    | readonly [NamedParameter<string, unknown>, ...NamedParameter<string, unknown>[]]
    | readonly [],
  TResult,
>(
  sqlString: string,
  returns: boolean,
): TypedSql<TParams, TResult> =>
  ({
    sql: sqlString,
    returns,
  }) as TypedSql<TParams, TResult>;

export type MigrationStatement = {
  sql: TypedSql<[], void>;
};

export type Migration = {
  name: string;
  statements: MigrationStatement[];
};

export const createTemplateApplier = (
  variables: Record<string, string>,
  functions?: Record<string, (...args: string[]) => string>,
): (<
  TParams extends
    | readonly [NamedParameter<string, unknown>, ...NamedParameter<string, unknown>[]]
    | readonly [],
  TResult,
>(
  typedSql: TypedSql<TParams, TResult>,
) => TypedSql<TParams, TResult>) => {
  const cache = new WeakMap<TypedSql<any, any>, TypedSql<any, any>>();
  const variableEntries = Object.entries(variables);
  const functionEntries = functions ? Object.entries(functions) : [];

  return <
    TParams extends
      | readonly [NamedParameter<string, unknown>, ...NamedParameter<string, unknown>[]]
      | readonly [],
    TResult,
  >(
    typedSql: TypedSql<TParams, TResult>,
  ): TypedSql<TParams, TResult> => {
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
    return cached as TypedSql<TParams, TResult>;
  };
};

export type MigrationResult = {
  skipped: string[];
  applied: string[];
  unrecognized: string[];
};

export const executeMigrations = async <TTxContext>({
  migrations,
  getAppliedMigrationNames,
  executeMigrationStatements,
  recordMigration,
}: {
  migrations: Migration[];
  getAppliedMigrationNames: (txContext: TTxContext) => Promise<string[]>;
  executeMigrationStatements: (txContext: TTxContext, migration: Migration) => Promise<void>;
  recordMigration: (txContext: TTxContext, name: string) => Promise<void>;
}): Promise<(txContext: TTxContext) => Promise<MigrationResult>> => {
  const migrationNames = new Set(migrations.map((m) => m.name));

  return async (txContext: TTxContext): Promise<MigrationResult> => {
    const previouslyApplied = await getAppliedMigrationNames(txContext);
    const previouslyAppliedSet = new Set(previouslyApplied);

    const skipped = previouslyApplied.filter((name) => migrationNames.has(name));
    const unrecognized = previouslyApplied.filter((name) => !migrationNames.has(name));
    const pending = migrations.filter((m) => !previouslyAppliedSet.has(m.name));
    const applied: string[] = [];

    for (const migration of pending) {
      await executeMigrationStatements(txContext, migration);
      await recordMigration(txContext, migration.name);
      applied.push(migration.name);
    }

    return { skipped, applied, unrecognized };
  };
};
