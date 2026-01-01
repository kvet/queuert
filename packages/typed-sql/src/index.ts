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
