import {
  BaseJobTypeDefinitions,
  blockerSymbol,
  continuationInputSymbol,
  continuationOutputSymbol,
  DefineBlocker,
  DefineContinuationInput,
  DefineContinuationOutput,
} from "./job-type.js";
import type { FirstJobTypeDefinitions } from "./job-type.navigation.js";

type NoVoidOrUndefined<T> = [T] extends [never]
  ? never
  : [T] extends [void]
    ? never
    : [T] extends [undefined]
      ? never
      : T;

type StripContinuationOutput<T> = Exclude<T, { [continuationOutputSymbol]: unknown }>;

type ValidateInput<TInput> = TInput extends {
  [continuationInputSymbol]: true;
  $inputType: infer U;
}
  ? DefineContinuationInput<NoVoidOrUndefined<U>>
  : NoVoidOrUndefined<TInput>;

type ValidateContinuationRef<TOutput, TValidKeys extends string> = TOutput extends {
  [continuationOutputSymbol]: true;
  $outputType: infer Ref;
}
  ? Ref extends TValidKeys
    ? TOutput
    : DefineContinuationOutput<TValidKeys>
  : TOutput;

type ValidateOutput<TOutput, TValidKeys extends string> = [
  StripContinuationOutput<TOutput>,
] extends [never]
  ? ValidateContinuationRef<TOutput, TValidKeys>
  :
      | NoVoidOrUndefined<StripContinuationOutput<TOutput>>
      | ValidateContinuationRef<
          Extract<TOutput, { [continuationOutputSymbol]: unknown }>,
          TValidKeys
        >;

type ValidateBlockerRef<TBlocker, TValidKeys extends string> = TBlocker extends {
  [blockerSymbol]: infer Ref;
}
  ? Ref extends TValidKeys
    ? TBlocker
    : DefineBlocker<TValidKeys>
  : TBlocker;

type ValidateBlockers<TBlockers, TValidKeys extends string> = TBlockers extends readonly [
  infer First,
  ...infer Rest,
]
  ? readonly [ValidateBlockerRef<First, TValidKeys>, ...ValidateBlockers<Rest, TValidKeys>]
  : TBlockers extends readonly (infer TElement)[]
    ? readonly ValidateBlockerRef<TElement, TValidKeys>[]
    : TBlockers;

export type ValidatedJobTypeDefinitions<T extends BaseJobTypeDefinitions> = {
  [K in keyof T]: {
    input: ValidateInput<T[K]["input"]>;
    output: ValidateOutput<T[K]["output"], keyof T & string>;
    blockers?: ValidateBlockers<
      T[K] extends { blockers: infer B } ? B : undefined,
      keyof FirstJobTypeDefinitions<T> & string
    >;
  };
};
