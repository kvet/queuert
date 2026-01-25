import { type CompletedJobChain, type JobChain } from "./job-chain.types.js";
import {
  type BaseJobTypeDefinitions,
  type JobTypeReference,
  type NominalReference,
  type StructuralReference,
} from "./job-type.js";
import { type CreatedJob, type Job, type JobWithoutBlockers } from "./job.js";

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

// Find job types matching an input structure
type MatchingJobTypesByInput<TDefs extends BaseJobTypeDefinitions, TInput> = {
  [K in keyof TDefs]: TDefs[K] extends { input: infer I }
    ? [TInput] extends [I]
      ? K
      : never
    : never;
}[keyof TDefs] &
  string;

// Resolve reference to job type name(s)
type ResolveReference<TDefs extends BaseJobTypeDefinitions, TRef> =
  TRef extends NominalReference<infer TN>
    ? TN & keyof TDefs
    : TRef extends StructuralReference<infer TI>
      ? MatchingJobTypesByInput<TDefs, TI>
      : never;

export type ContinuationJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = TJobTypeDefinitions[TJobTypeName] extends { continueWith: infer CT }
  ? ResolveReference<TJobTypeDefinitions, CT>
  : never;

export type ChainJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
  Visited extends keyof TJobTypeDefinitions = never,
> = TJobTypeName extends Visited
  ? never
  :
      | TJobTypeName
      | {
          [K in ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>]: ChainJobTypes<
            TJobTypeDefinitions,
            K,
            Visited | TJobTypeName
          >;
        }[ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>];

export type ChainTypesReaching<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = {
  [K in keyof EntryJobTypeDefinitions<TJobTypeDefinitions>]: TJobTypeName extends ChainJobTypes<
    TJobTypeDefinitions,
    K
  >
    ? K
    : never;
}[keyof EntryJobTypeDefinitions<TJobTypeDefinitions>];

export type JobOf<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
    ChainTypesReaching<TJobTypeDefinitions, TJobTypeName>,
> = Job<
  TJobId,
  TJobTypeName,
  TChainTypeName,
  ExtractInputType<TJobTypeDefinitions[TJobTypeName]>,
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
    JobWithoutBlockers<JobOf<TJobId, TJobTypeDefinitions, K, TChainTypeName>>
  >;
}[ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>];

export type JobChainOf<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName,
> = TJobTypeName extends keyof TJobTypeDefinitions
  ? {
      [K in ChainJobTypes<TJobTypeDefinitions, TJobTypeName> & keyof TJobTypeDefinitions]: JobChain<
        TJobId,
        TJobTypeName & string,
        ExtractInputType<TJobTypeDefinitions[K]>,
        ExtractOutputType<TJobTypeDefinitions[K]>
      >;
    }[ChainJobTypes<TJobTypeDefinitions, TJobTypeName> & keyof TJobTypeDefinitions]
  : never;

type GetBlockersProperty<T> = T extends { blockers: infer B } ? B : never;

// Map reference to chain type
type ReferenceToChain<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TRef,
> = JobChainOf<TJobId, TJobTypeDefinitions, ResolveReference<TJobTypeDefinitions, TRef>>;

// Updated to handle references (replaces MapStringBlockersToChains)
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

export type HasBlockers<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = BlockerChains<string, TJobTypeDefinitions, TJobTypeName> extends [] ? false : true;

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

export type ChainJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
> = {
  [K in ChainJobTypes<TJobTypeDefinitions, TChainTypeName> & keyof TJobTypeDefinitions]: JobOf<
    TJobId,
    TJobTypeDefinitions,
    K,
    TChainTypeName
  >;
}[ChainJobTypes<TJobTypeDefinitions, TChainTypeName> & keyof TJobTypeDefinitions];
