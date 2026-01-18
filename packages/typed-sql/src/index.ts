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
  noTransaction?: boolean;
};

export type MigrationGroup = {
  noTransaction: boolean;
  statements: MigrationStatement[];
};

export const groupMigrationStatements = (statements: MigrationStatement[]): MigrationGroup[] => {
  const groups: MigrationGroup[] = [];
  let currentGroup: MigrationStatement[] = [];
  let currentNoTransaction = false;

  for (const stmt of statements) {
    const stmtNoTransaction = stmt.noTransaction ?? false;

    if (stmtNoTransaction) {
      if (currentGroup.length > 0) {
        groups.push({ noTransaction: currentNoTransaction, statements: currentGroup });
        currentGroup = [];
      }
      groups.push({ noTransaction: true, statements: [stmt] });
    } else {
      if (currentNoTransaction && currentGroup.length > 0) {
        groups.push({ noTransaction: currentNoTransaction, statements: currentGroup });
        currentGroup = [];
      }
      currentNoTransaction = false;
      currentGroup.push(stmt);
    }
  }

  if (currentGroup.length > 0) {
    groups.push({ noTransaction: currentNoTransaction, statements: currentGroup });
  }

  return groups;
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
