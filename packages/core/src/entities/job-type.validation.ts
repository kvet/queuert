import {
  type BaseJobTypeDefinitions,
  type JobTypeReference,
  type NominalJobTypeReference,
  type StructuralJobTypeReference,
} from "./job-type.js";

type NoVoid<T> = [T] extends [void] ? never : T;
type NoVoidOrUndefined<T> = [T] extends [void | undefined] ? never : T;

type MatchingJobTypesByInput<TJobTypeDefinitions, TInput> =
  TJobTypeDefinitions extends BaseJobTypeDefinitions
    ? {
        [K in keyof TJobTypeDefinitions]: TJobTypeDefinitions[K] extends { input: infer I }
          ? [TInput] extends [I]
            ? K
            : never
          : never;
      }[keyof TJobTypeDefinitions] &
        string
    : never;

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

type ValidateReference<TRef, TJobTypeDefinitions, TValidKeys extends string> =
  TRef extends NominalJobTypeReference<infer TN>
    ? TN extends TValidKeys
      ? TRef
      : NominalJobTypeReference<TValidKeys>
    : TRef extends StructuralJobTypeReference<infer TI>
      ? [MatchingJobTypesByInput<TJobTypeDefinitions, TI>] extends [never]
        ? never
        : TRef
      : never;

type ValidateContinueWith<
  T,
  TJobTypeDefinitions,
  TValidKeys extends string,
> = T extends JobTypeReference ? ValidateReference<T, TJobTypeDefinitions, TValidKeys> : T;

type EntryTypeKeys<T> = T extends BaseJobTypeDefinitions
  ? {
      [K in keyof T]: T[K] extends { entry: true } ? K : never;
    }[keyof T] &
      string
  : never;

type AllKeys<T> = T extends BaseJobTypeDefinitions ? keyof T & string : never;

type ValidateBlockers<T, TJobTypeDefinitions, TEntryKeys extends string> = T extends readonly [
  infer First extends JobTypeReference,
  ...infer Rest,
]
  ? readonly [
      ValidateReference<First, TJobTypeDefinitions, TEntryKeys>,
      ...ValidateBlockers<Rest, TJobTypeDefinitions, TEntryKeys>,
    ]
  : T extends readonly (infer TElement extends JobTypeReference)[]
    ? readonly ValidateReference<TElement, TJobTypeDefinitions, TEntryKeys>[]
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

type ValidateJobType<
  TJobType,
  TLocal extends BaseJobTypeDefinitions,
  TAll extends BaseJobTypeDefinitions,
> = {
  entry?: TJobType extends { entry: infer E extends boolean } ? E : never;
  input: NoVoidOrUndefined<TJobType extends { input: infer I } ? I : never>;
  continueWith?: ValidateContinueWith<
    TJobType extends { continueWith: infer CT } ? CT : undefined,
    TLocal,
    keyof TLocal & string
  >;
} & OutputProperty<TJobType> &
  BlockersProperty<TJobType, TAll>;

type OverlappingKeys<A, B> = keyof A & AllKeys<B>;

/** Marker type for compile-time validated job type definitions. Applied by {@link defineJobTypes}. */
export type ValidatedJobTypeDefinitions<
  T extends BaseJobTypeDefinitions,
  TExternal extends BaseJobTypeDefinitions,
> = [OverlappingKeys<T, TExternal>] extends [never]
  ? {
      [K in keyof T]: ValidateJobType<T[K], T, T | TExternal>;
    }
  : `Error: local and external definitions share overlapping keys: ${OverlappingKeys<T, TExternal> & string}`;

type InvalidJobTypeKeys<
  T extends BaseJobTypeDefinitions,
  TExternal extends BaseJobTypeDefinitions,
> = {
  [K in keyof T & string]: [T[K]] extends [ValidateJobType<T[K], T, T | TExternal>] ? never : K;
}[keyof T & string];

/** Descriptive error type produced when job type definitions fail validation. Lists the invalid type names. */
export type JobTypeDefinitionErrors<
  T extends BaseJobTypeDefinitions,
  TExternal extends BaseJobTypeDefinitions = Record<never, never>,
> = [OverlappingKeys<T, TExternal>] extends [never]
  ? `Error: invalid job type definitions. Check the following types: ${InvalidJobTypeKeys<T, TExternal>}`
  : `Error: local and external definitions share overlapping keys: ${OverlappingKeys<T, TExternal> & string}`;
