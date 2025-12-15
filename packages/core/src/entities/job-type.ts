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

export const continuationInputSymbol: unique symbol = Symbol("continuationInput");

export type DefineContinuationInput<T> = T & { [continuationInputSymbol]: true };

export type UnwrapContinuationInput<T> = T extends { [continuationInputSymbol]: true }
  ? Omit<T, typeof continuationInputSymbol>
  : T;

export type FirstJobTypeDefinitions<T extends BaseJobTypeDefinitions> = {
  [K in keyof T as T[K]["input"] extends { [continuationInputSymbol]: true } ? never : K]: T[K];
};

export const continuationOutputSymbol: unique symbol = Symbol("continuationOutput");

export type DefineContinuationOutput<T extends string> = { [continuationOutputSymbol]: T };
