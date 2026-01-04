export type BaseJobTypeDefinitions = Record<
  string,
  {
    input: unknown;
    output: unknown;
    blockers?: readonly unknown[];
  }
>;

export type DefineJobTypeDefinitions<T extends BaseJobTypeDefinitions> = T;

export const continuationInputSymbol: unique symbol = Symbol("continuationInput");

export type DefineContinuationInput<T> = {
  [continuationInputSymbol]: true;
  $inputType: T;
};

export const continuationOutputSymbol: unique symbol = Symbol("continuationOutput");

export type DefineContinuationOutput<T extends string> = {
  [continuationOutputSymbol]: true;
  $outputType: T;
};

export const blockerSymbol: unique symbol = Symbol("blocker");

export type DefineBlocker<T extends string> = { [blockerSymbol]: T };

import { ValidatedJobTypeDefinitions } from "./job-type.validation.js";

export const defineUnionJobTypes = <
  T extends BaseJobTypeDefinitions & ValidatedJobTypeDefinitions<T>,
>() => {
  return {} as T;
};

export * from "./job-type.navigation.js";
