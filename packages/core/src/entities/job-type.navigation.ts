import { CompletedJobSequence, JobSequence } from "./job-sequence.types.js";
import {
  BaseJobTypeDefinitions,
  JobTypeReference,
  NominalReference,
  StructuralReference,
} from "./job-type.js";
import { CreatedJob, Job, JobWithoutBlockers } from "./job.js";

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
> = TJobTypeDefinitions[TJobTypeName] extends { continuesTo: infer CT }
  ? ResolveReference<TJobTypeDefinitions, CT>
  : never;

export type SequenceJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
  Visited extends keyof TJobTypeDefinitions = never,
> = TJobTypeName extends Visited
  ? never
  :
      | TJobTypeName
      | {
          [K in ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>]: SequenceJobTypes<
            TJobTypeDefinitions,
            K,
            Visited | TJobTypeName
          >;
        }[ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>];

export type SequenceTypesReaching<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = {
  [K in keyof EntryJobTypeDefinitions<TJobTypeDefinitions>]: TJobTypeName extends SequenceJobTypes<
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
  TSequenceTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
    SequenceTypesReaching<TJobTypeDefinitions, TJobTypeName>,
> = Job<
  TJobId,
  TJobTypeName,
  TSequenceTypeName,
  ExtractInputType<TJobTypeDefinitions[TJobTypeName]>,
  CompletedBlockerSequences<TJobId, TJobTypeDefinitions, TJobTypeName & string>
>;

export type ContinuationJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
  TSequenceTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string =
    SequenceTypesReaching<TJobTypeDefinitions, TJobTypeName>,
> = {
  [K in ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>]: CreatedJob<
    JobWithoutBlockers<JobOf<TJobId, TJobTypeDefinitions, K, TSequenceTypeName>>
  >;
}[ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>];

export type JobSequenceOf<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName,
> = TJobTypeName extends keyof TJobTypeDefinitions
  ? {
      [K in SequenceJobTypes<TJobTypeDefinitions, TJobTypeName> &
        keyof TJobTypeDefinitions]: JobSequence<
        TJobId,
        TJobTypeName & string,
        ExtractInputType<TJobTypeDefinitions[K]>,
        ExtractOutputType<TJobTypeDefinitions[K]>
      >;
    }[SequenceJobTypes<TJobTypeDefinitions, TJobTypeName> & keyof TJobTypeDefinitions]
  : never;

type GetBlockersProperty<T> = T extends { blockers: infer B } ? B : never;

// Map reference to sequence type
type ReferenceToSequence<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TRef,
> = JobSequenceOf<TJobId, TJobTypeDefinitions, ResolveReference<TJobTypeDefinitions, TRef>>;

// Updated to handle references (replaces MapStringBlockersToSequences)
type MapBlockersToSequences<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockers,
> = TBlockers extends readonly [infer First extends JobTypeReference, ...infer Rest]
  ? [
      ReferenceToSequence<TJobId, TJobTypeDefinitions, First>,
      ...MapBlockersToSequences<TJobId, TJobTypeDefinitions, Rest>,
    ]
  : TBlockers extends readonly (infer TElement extends JobTypeReference)[]
    ? ReferenceToSequence<TJobId, TJobTypeDefinitions, TElement>[]
    : [];

export type BlockerSequences<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> =
  GetBlockersProperty<TJobTypeDefinitions[TJobTypeName]> extends infer TBlockers
    ? [TBlockers] extends [never]
      ? []
      : TBlockers extends readonly unknown[]
        ? MapBlockersToSequences<TJobId, TJobTypeDefinitions, TBlockers>
        : []
    : [];

export type HasBlockers<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = BlockerSequences<string, TJobTypeDefinitions, TJobTypeName> extends [] ? false : true;

type MapToCompletedSequences<TBlockers> = TBlockers extends [
  infer First extends JobSequence<string, string, unknown, unknown>,
  ...infer Rest,
]
  ? [CompletedJobSequence<First>, ...MapToCompletedSequences<Rest>]
  : TBlockers extends (infer TElement extends JobSequence<string, string, unknown, unknown>)[]
    ? CompletedJobSequence<TElement>[]
    : [];

export type CompletedBlockerSequences<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = MapToCompletedSequences<BlockerSequences<TJobId, TJobTypeDefinitions, TJobTypeName>>;

export type SequenceJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TSequenceTypeName extends keyof EntryJobTypeDefinitions<TJobTypeDefinitions> & string,
> = {
  [K in SequenceJobTypes<TJobTypeDefinitions, TSequenceTypeName> &
    keyof TJobTypeDefinitions]: JobOf<TJobId, TJobTypeDefinitions, K, TSequenceTypeName>;
}[SequenceJobTypes<TJobTypeDefinitions, TSequenceTypeName> & keyof TJobTypeDefinitions];
