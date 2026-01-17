import {
  BaseJobTypeDefinitions,
  JobTypeReference,
  NominalReference,
  StructuralReference,
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

type HasContinuesTo<TJobType> = TJobType extends { continuesTo: JobTypeReference } ? true : false;

type ValidateOutput<TJobType> =
  HasContinuesTo<TJobType> extends true
    ? TJobType extends { output: infer O }
      ? O extends undefined
        ? undefined
        : NoVoid<O>
      : undefined
    : TJobType extends { output: infer O }
      ? NoVoidOrUndefined<O>
      : never;

type ValidateReference<TRef, TDefs extends BaseJobTypeDefinitions, TValidKeys extends string> =
  TRef extends NominalReference<infer TN>
    ? TN extends TValidKeys
      ? TRef
      : NominalReference<TValidKeys>
    : TRef extends StructuralReference<infer TI>
      ? [MatchingJobTypesByInput<TDefs, TI>] extends [never]
        ? never
        : TRef
      : never;

type ValidateContinuesTo<
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
  HasContinuesTo<TJobType> extends true
    ? [ExtractOutput<TJobType>] extends [undefined]
      ? { output?: ValidateOutput<TJobType> }
      : { output: ValidateOutput<TJobType> }
    : { output: ValidateOutput<TJobType> };

type BlockersProperty<TJobType, T extends BaseJobTypeDefinitions> = [
  ExtractBlockers<TJobType>,
] extends [undefined]
  ? { blockers?: undefined }
  : { blockers: ValidateBlockers<ExtractBlockers<TJobType>, T, EntryTypeKeys<T>> };

type ValidateJobType<TJobType, TValidKeys extends string, T extends BaseJobTypeDefinitions> = {
  entry?: TJobType extends { entry: infer E extends boolean } ? E : never;
  input: NoVoidOrUndefined<TJobType extends { input: infer I } ? I : never>;
  continuesTo?: ValidateContinuesTo<
    TJobType extends { continuesTo: infer CT } ? CT : undefined,
    T,
    TValidKeys
  >;
} & OutputProperty<TJobType> &
  BlockersProperty<TJobType, T>;

export type ValidatedJobTypeDefinitions<T extends BaseJobTypeDefinitions> = {
  [K in keyof T]: ValidateJobType<T[K], keyof T & string, T>;
};
