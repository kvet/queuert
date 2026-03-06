import { type CompletedJobChain, type JobChain } from "./job-chain.types.js";
import {
  type BaseJobTypeDefinitions,
  type JobTypeReference,
  type NominalJobTypeReference,
  type StructuralJobTypeReference,
} from "./job-type.js";
import { type CreatedJob, type Job, type JobWithBlockers } from "./job.js";

// Detect 'any' type (0 extends 1 & T is true only when T is any)
type IsAny<T> = 0 extends 1 & T ? true : false;

// Determines if a job type is an entry point:
// - Returns true for `any` types (permissive for generic code)
// - Returns true for types with explicit `entry: true`
// - Returns true for types with optional `entry?: boolean` (like BaseJobTypeDefinition)
// - Returns false otherwise (no entry field or `entry: false`)
type IsEntryJobType<TJobType> =
  IsAny<TJobType> extends true
    ? true
    : TJobType extends { entry: true }
      ? true
      : undefined extends TJobType["entry" & keyof TJobType]
        ? true // entry is optional - be permissive for generic types
        : false;

export type EntryJobTypeDefinitions<T extends BaseJobTypeDefinitions> = {
  [K in keyof T as IsEntryJobType<T[K]> extends true ? K : never]: T[K];
};

type ExtractInputType<TJobType> = TJobType extends { input: infer U } ? U : never;

type ExtractOutputType<TJobType> = TJobType extends { output: infer Out }
  ? Out extends undefined
    ? never
    : Out
  : never;

type MatchingJobTypesByInput<TDefs extends BaseJobTypeDefinitions, TInput> = {
  [K in keyof TDefs]: TDefs[K] extends { input: infer I }
    ? [TInput] extends [I]
      ? K
      : never
    : never;
}[keyof TDefs] &
  string;

type ResolveReference<TDefs extends BaseJobTypeDefinitions, TRef> =
  TRef extends NominalJobTypeReference<infer TN>
    ? TN & keyof TDefs
    : TRef extends StructuralJobTypeReference<infer TI>
      ? MatchingJobTypesByInput<TDefs, TI>
      : never;

export type ContinuationJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = TJobTypeDefinitions[TJobTypeName] extends { continueWith: infer CT }
  ? ResolveReference<TJobTypeDefinitions, CT>
  : never;

export type ChainJobTypeNames<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
  Visited extends keyof TJobTypeDefinitions = never,
> = TJobTypeName extends Visited
  ? never
  :
      | TJobTypeName
      | {
          [K in ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>]: ChainJobTypeNames<
            TJobTypeDefinitions,
            K,
            Visited | TJobTypeName
          >;
        }[ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>];

export type ChainTypesReaching<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = {
  [K in keyof EntryJobTypeDefinitions<TJobTypeDefinitions>]: TJobTypeName extends ChainJobTypeNames<
    TJobTypeDefinitions,
    K
  >
    ? K
    : never;
}[keyof EntryJobTypeDefinitions<TJobTypeDefinitions>];

export type ResolvedJob<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
    ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>,
> = Job<TJobId, TJobTypeName, TChainTypeName, ExtractInputType<TJobTypeDefinitions[TJobTypeName]>>;

export type ResolvedJobWithBlockers<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
    ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>,
> = JobWithBlockers<
  ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName>,
  CompletedBlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName & string>
>;

export type ContinuationJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
    ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>,
> = {
  [K in ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>]: CreatedJob<
    ResolvedJob<TJobId, TJobTypeDefinitions, K, TChainTypeName>
  >;
}[ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>];

export type ResolvedJobChain<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName,
> = TJobTypeName extends keyof TJobTypeDefinitions
  ? {
      [K in ChainJobTypeNames<TJobTypeDefinitions, TJobTypeName> &
        keyof TJobTypeDefinitions]: JobChain<
        TJobId,
        TJobTypeName & string,
        ExtractInputType<TJobTypeDefinitions[K]>,
        ExtractOutputType<TJobTypeDefinitions[K]>
      >;
    }[ChainJobTypeNames<TJobTypeDefinitions, TJobTypeName> & keyof TJobTypeDefinitions]
  : never;

type GetBlockersProperty<T> = T extends { blockers: infer B } ? B : never;

type ReferenceToChain<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TRef,
> = ResolvedJobChain<TJobId, TJobTypeDefinitions, ResolveReference<TJobTypeDefinitions, TRef>>;

type MapBlockersToChains<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockers,
> = TBlockers extends readonly [infer First extends JobTypeReference, ...infer Rest]
  ? [
      ReferenceToChain<TJobId, TJobTypeDefinitions, First>,
      ...MapBlockersToChains<TJobId, TJobTypeDefinitions, Rest>,
    ]
  : TBlockers extends readonly (infer TElement extends JobTypeReference)[]
    ? ReferenceToChain<TJobId, TJobTypeDefinitions, TElement>[]
    : [];

export type BlockerChains<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> =
  GetBlockersProperty<TJobTypeDefinitions[TJobTypeName]> extends infer TBlockers
    ? [TBlockers] extends [never]
      ? []
      : TBlockers extends readonly unknown[]
        ? MapBlockersToChains<TJobId, TJobTypeDefinitions, TBlockers>
        : []
    : [];

export type JobTypeHasBlockers<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = BlockerChains<string, TJobTypeDefinitions, TJobTypeName> extends [] ? false : true;

type BlockerRefChainNames<TJobTypeDefinitions extends BaseJobTypeDefinitions, T> = T extends {
  blockers: readonly (infer TRef)[];
}
  ? ResolveReference<TJobTypeDefinitions, TRef>
  : never;

export type BlockedJobTypeNames<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockerChainTypeName extends string,
> = {
  [K in keyof TJobTypeDefinitions & string]: TBlockerChainTypeName extends BlockerRefChainNames<
    TJobTypeDefinitions,
    TJobTypeDefinitions[K]
  >
    ? K
    : never;
}[keyof TJobTypeDefinitions & string];

type MapToCompletedChains<TBlockers> = TBlockers extends [
  infer First extends JobChain<string, string, unknown, unknown>,
  ...infer Rest,
]
  ? [CompletedJobChain<First>, ...MapToCompletedChains<Rest>]
  : TBlockers extends (infer TElement extends JobChain<string, string, unknown, unknown>)[]
    ? CompletedJobChain<TElement>[]
    : [];

export type CompletedBlockerChains<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = MapToCompletedChains<BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>>;

export type ResolvedChainJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
> = {
  [K in ChainJobTypeNames<TJobTypeDefinitions, TChainTypeName> &
    keyof TJobTypeDefinitions]: ResolvedJob<TJobId, TJobTypeDefinitions, K, TChainTypeName>;
}[ChainJobTypeNames<TJobTypeDefinitions, TChainTypeName> & keyof TJobTypeDefinitions];
