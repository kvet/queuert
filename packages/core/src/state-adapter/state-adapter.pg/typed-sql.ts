export type NamedParameter<
  TParamName extends string,
  TParamValue,
> = TParamValue & {
  /* @deprecated - type-only */
  $paramName?: TParamName;
};

export type TypedSql<
  TParams extends
    | readonly [
        NamedParameter<string, unknown>,
        ...NamedParameter<string, unknown>[],
      ]
    | readonly [],
  TResult,
> = string & {
  /* @deprecated - type-only */
  $paramsType?: TParams;
  /* @deprecated - type-only */
  $resultType?: TResult;
};

export const executeTypedSql = async <
  TParams extends
    | readonly [
        NamedParameter<string, unknown>,
        ...NamedParameter<string, unknown>[],
      ]
    | readonly [],
  TResult,
>({
  executeSql,
  sql,
  params,
}: {
  executeSql: <T>(query: string, params?: unknown[]) => Promise<T>;
  sql: TypedSql<TParams, TResult>;
} & (TParams extends readonly []
  ? { params?: undefined }
  : { params: TParams })): Promise<TResult> =>
  executeSql<TResult>(sql, params as any);
