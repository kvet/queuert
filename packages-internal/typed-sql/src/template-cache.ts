import { type DataType, type TypedSql } from "./sql.js";

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
