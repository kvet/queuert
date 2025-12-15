export type BaseJobTypeDefinitions = Record<
  string,
  {
    input: any;
    output: any;
  }
>;

export const defineUnionJobTypes = <T extends BaseJobTypeDefinitions>() => {
  return {} as T;
};

export const jobTypeRefSymbol: unique symbol = Symbol("jobTypeRef");

export type DefineJobTypeRef<T extends string> = { [jobTypeRefSymbol]: T };
