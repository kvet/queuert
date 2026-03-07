import {
  type BaseJobTypeDefinitions,
  type JobTypeReference,
  type NominalJobTypeReference,
  type StructuralJobTypeReference,
} from "./job-type.js";

type NoVoid<T> = [T] extends [void] ? never : T;
type NoVoidOrUndefined<T> = [T] extends [void | undefined] ? never : T;

type MatchingJobTypesByInput<TDefs extends BaseJobTypeDefinitions, TInput> = {
  [K in keyof TDefs]: TDefs[K] extends { input: infer I }
    ? [TInput] extends [I]
      ? K
      : never
    : never;
}[keyof TDefs] &
  string;

type HasContinueWith<TJobType> = TJobType extends { continueWith: JobTypeReference } ? true : false;

type ValidateOutput<TJobType> =
  HasContinueWith<TJobType> extends true
    ? TJobType extends { output: infer O }
      ? O extends undefined
        ? undefined
        : NoVoid<O>
      : undefined
    : TJobType extends { output: infer O }
      ? NoVoidOrUndefined<O>
      : never;

type ValidateReference<TRef, TDefs extends BaseJobTypeDefinitions, TValidKeys extends string> =
  TRef extends NominalJobTypeReference<infer TN>
    ? TN extends TValidKeys
      ? TRef
      : NominalJobTypeReference<TValidKeys>
    : TRef extends StructuralJobTypeReference<infer TI>
      ? [MatchingJobTypesByInput<TDefs, TI>] extends [never]
        ? never
        : TRef
      : never;

type ValidateContinueWith<
  T,
  TDefs extends BaseJobTypeDefinitions,
  TValidKeys extends string,
> = T extends JobTypeReference ? ValidateReference<T, TDefs, TValidKeys> : T;

type EntryTypeKeys<T extends BaseJobTypeDefinitions> = {
  [K in keyof T]: T[K] extends { entry: true } ? K : never;
}[keyof T] &
  string;

type ValidateBlockers<
  T,
  TDefs extends BaseJobTypeDefinitions,
  TEntryKeys extends string,
> = T extends readonly [infer First extends JobTypeReference, ...infer Rest]
  ? readonly [
      ValidateReference<First, TDefs, TEntryKeys>,
      ...ValidateBlockers<Rest, TDefs, TEntryKeys>,
    ]
  : T extends readonly (infer TElement extends JobTypeReference)[]
    ? readonly ValidateReference<TElement, TDefs, TEntryKeys>[]
    : T;

type ExtractOutput<T> = T extends { output: infer O } ? O : undefined;

type ExtractBlockers<T> = T extends { blockers: infer B } ? B : undefined;

type OutputProperty<TJobType> =
  HasContinueWith<TJobType> extends true
    ? [ExtractOutput<TJobType>] extends [undefined]
      ? { output?: ValidateOutput<TJobType> }
      : { output: ValidateOutput<TJobType> }
    : { output: ValidateOutput<TJobType> };

type BlockersProperty<TJobType, TAll extends BaseJobTypeDefinitions> = [
  ExtractBlockers<TJobType>,
] extends [undefined]
  ? { blockers?: undefined }
  : { blockers: ValidateBlockers<ExtractBlockers<TJobType>, TAll, EntryTypeKeys<TAll>> };

type ValidateJobType<TJobType, TLocalKeys extends string, TAll extends BaseJobTypeDefinitions> = {
  entry?: TJobType extends { entry: infer E extends boolean } ? E : never;
  input: NoVoidOrUndefined<TJobType extends { input: infer I } ? I : never>;
  continueWith?: ValidateContinueWith<
    TJobType extends { continueWith: infer CT } ? CT : undefined,
    TAll,
    TLocalKeys
  >;
} & OutputProperty<TJobType> &
  BlockersProperty<TJobType, TAll>;

type OverlappingKeys<A, B> = keyof A & keyof B;

/** Marker type for compile-time validated job type definitions. Applied by {@link defineJobTypes}. */
export type ValidatedJobTypeDefinitions<
  T extends BaseJobTypeDefinitions,
  TExternal extends BaseJobTypeDefinitions = Record<never, never>,
> = [OverlappingKeys<T, TExternal>] extends [never]
  ? {
      [K in keyof T]: ValidateJobType<T[K], keyof T & string, T & TExternal>;
    }
  : `Error: local and external definitions share overlapping keys: ${OverlappingKeys<T, TExternal> & string}`;
