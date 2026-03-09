import {
  type BaseJobTypeDefinitions,
  type JobTypeReference,
  type NominalJobTypeReference,
  type StructuralJobTypeReference,
} from "./job-type.js";

// ─── Internal computation types (operate on raw job type definitions) ───

type _IsAny<T> = 0 extends 1 & T ? true : false;

type _IsEntryJobType<TJobType> =
  _IsAny<TJobType> extends true
    ? true
    : TJobType extends { entry: true }
      ? true
      : undefined extends TJobType["entry" & keyof TJobType]
        ? true // entry is optional or absent — be permissive for generic types
        : false;

type _EntryKeys<TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [K in keyof TJobTypeDefinitions & string]: _IsEntryJobType<TJobTypeDefinitions[K]> extends true
    ? K
    : never;
}[keyof TJobTypeDefinitions & string];

type _ExtractInputType<TJobType> = TJobType extends { input: infer U } ? U : never;

type _ExtractOutputType<TJobType> = TJobType extends { output: infer Out }
  ? Out extends undefined
    ? never
    : Out
  : never;

type _MatchingJobTypesByInput<TJobTypeDefinitions extends BaseJobTypeDefinitions, TInput> = {
  [K in keyof TJobTypeDefinitions]: TJobTypeDefinitions[K] extends { input: infer I }
    ? [TInput] extends [I]
      ? K
      : never
    : never;
}[keyof TJobTypeDefinitions] &
  string;

type _ResolveReference<TJobTypeDefinitions extends BaseJobTypeDefinitions, TRef> =
  TRef extends NominalJobTypeReference<infer TN>
    ? TN & keyof TJobTypeDefinitions
    : TRef extends StructuralJobTypeReference<infer TI>
      ? _MatchingJobTypesByInput<TJobTypeDefinitions, TI>
      : never;

type _ContinuationJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = TJobTypeDefinitions[TJobTypeName] extends { continueWith: infer CT }
  ? _ResolveReference<TJobTypeDefinitions, CT>
  : never;

type _ChainJobTypeNames<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
  _Visited extends keyof TJobTypeDefinitions = never,
> = [TJobTypeName] extends [never]
  ? _Visited
  : TJobTypeName extends _Visited
    ? _Visited
    : _ChainJobTypeNames<
        TJobTypeDefinitions,
        _ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>,
        _Visited | TJobTypeName
      >;

type _ChainReachMap<TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [TypeName in keyof TJobTypeDefinitions]: {
    [K in _EntryKeys<TJobTypeDefinitions>]: TypeName extends _ChainJobTypeNames<
      TJobTypeDefinitions,
      K
    >
      ? K
      : never;
  }[_EntryKeys<TJobTypeDefinitions>];
};

type _GetBlockersProperty<T> = T extends { blockers: infer B } ? B : never;

type _JobTypeHasBlockers<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = TJobTypeDefinitions[TJobTypeName] extends { blockers: readonly [] }
  ? false
  : TJobTypeDefinitions[TJobTypeName] extends { blockers: readonly unknown[] }
    ? true
    : false;

// ─── NavigationMap (pre-computed per slice at defineJobTypeRegistry time) ───

export type NavigationMap<TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [K in keyof TJobTypeDefinitions & string]: {
    continuationTypes: _ContinuationJobTypes<TJobTypeDefinitions, K> & string;
    reachingEntries: _ChainReachMap<TJobTypeDefinitions>[K] & string;
    input: _ExtractInputType<TJobTypeDefinitions[K]>;
    output: _ExtractOutputType<TJobTypeDefinitions[K]>;
    isEntry: _IsEntryJobType<TJobTypeDefinitions[K]>;
    hasBlockers: _JobTypeHasBlockers<TJobTypeDefinitions, K>;
    blockerRefs: _GetBlockersProperty<TJobTypeDefinitions[K]> extends infer B extends
      readonly JobTypeReference[]
      ? B
      : readonly [];
  };
};

export type BaseNavigationEntry = {
  continuationTypes: string;
  reachingEntries: string;
  input: unknown;
  output: unknown;
  isEntry: boolean;
  hasBlockers: boolean;
  blockerRefs: readonly JobTypeReference[];
};

export type BaseNavigationMap = Record<string, BaseNavigationEntry>;
