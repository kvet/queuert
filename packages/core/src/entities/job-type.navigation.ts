import { CompletedJobSequence, JobSequence } from "./job-sequence.types.js";
import {
  BaseJobTypeDefinitions,
  blockerSymbol,
  continuationInputSymbol,
  continuationOutputSymbol,
} from "./job-type.js";
import { CreatedJob, Job, JobWithoutBlockers } from "./job.js";

export type ExternalJobTypeDefinitions<T extends BaseJobTypeDefinitions> = {
  [K in keyof T as T[K]["input"] extends { [continuationInputSymbol]: true } ? never : K]: T[K];
};

type UnwrapContinuationInput<T> = T extends {
  [continuationInputSymbol]: true;
  $inputType: infer U;
}
  ? U
  : T;

export type JobOf<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
  TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string =
    SequenceTypesReaching<TJobTypeDefinitions, TJobTypeName>,
> = Job<
  TJobId,
  TJobTypeName,
  TSequenceTypeName,
  UnwrapContinuationInput<TJobTypeDefinitions[TJobTypeName]["input"]>,
  CompletedBlockerSequences<TJobId, TJobTypeDefinitions, TJobTypeName & string>
>;

type MemberContinuationJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  Out,
> = Out extends {
  [continuationOutputSymbol]: true;
  $outputType: infer Ref;
}
  ? Extract<Ref, keyof TJobTypeDefinitions>
  : {
      [K in keyof TJobTypeDefinitions]: Out extends TJobTypeDefinitions[K]["input"]
        ? TJobTypeDefinitions[K]["input"] extends Out
          ? K
          : never
        : never;
    }[keyof TJobTypeDefinitions];

export type ContinuationJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = TJobTypeDefinitions[TJobTypeName]["output"] extends infer Out
  ? MemberContinuationJobTypes<TJobTypeDefinitions, Out>
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
  [K in keyof ExternalJobTypeDefinitions<TJobTypeDefinitions>]: TJobTypeName extends SequenceJobTypes<
    TJobTypeDefinitions,
    K
  >
    ? K
    : never;
}[keyof ExternalJobTypeDefinitions<TJobTypeDefinitions>];

export type ContinuationJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
  TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string =
    SequenceTypesReaching<TJobTypeDefinitions, TJobTypeName>,
> = {
  [K in ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>]: CreatedJob<
    JobWithoutBlockers<JobOf<TJobId, TJobTypeDefinitions, K, TSequenceTypeName>>
  >;
}[ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>];

type StripContinuationOutputs<T> = Exclude<T, { [continuationOutputSymbol]: any }>;

export type JobSequenceOf<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = {
  [K in SequenceJobTypes<TJobTypeDefinitions, TJobTypeName> &
    keyof TJobTypeDefinitions]: JobSequence<
    TJobId,
    TJobTypeName,
    UnwrapContinuationInput<TJobTypeDefinitions[K]["input"]>,
    StripContinuationOutputs<TJobTypeDefinitions[K]["output"]>
  >;
}[SequenceJobTypes<TJobTypeDefinitions, TJobTypeName> & keyof TJobTypeDefinitions];

type BlockerSequenceOf<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockerSpec,
> = TBlockerSpec extends { [blockerSymbol]: infer TName }
  ? TName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string
    ? JobSequenceOf<TJobId, TJobTypeDefinitions, TName>
    : never
  : TBlockerSpec extends object
    ? {
        [K in keyof ExternalJobTypeDefinitions<TJobTypeDefinitions>]: TJobTypeDefinitions[K]["input"] extends TBlockerSpec
          ? TBlockerSpec extends TJobTypeDefinitions[K]["input"]
            ? JobSequenceOf<TJobId, TJobTypeDefinitions, K>
            : never
          : never;
      }[keyof ExternalJobTypeDefinitions<TJobTypeDefinitions>]
    : never;

type MapBlockerSequences<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockers,
> = TBlockers extends readonly [infer First, ...infer Rest]
  ? [
      BlockerSequenceOf<TJobId, TJobTypeDefinitions, First>,
      ...MapBlockerSequences<TJobId, TJobTypeDefinitions, Rest>,
    ]
  : TBlockers extends readonly (infer TElement)[]
    ? BlockerSequenceOf<TJobId, TJobTypeDefinitions, TElement>[]
    : [];

export type BlockerSequences<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = TJobTypeDefinitions[TJobTypeName] extends { blockers: infer TBlockers }
  ? MapBlockerSequences<TJobId, TJobTypeDefinitions, TBlockers>
  : [];

export type HasBlockers<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = BlockerSequences<string, TJobTypeDefinitions, TJobTypeName> extends [] ? false : true;

type MapToCompletedSequences<TBlockers> = TBlockers extends [
  infer First extends JobSequence<any, any, any, any>,
  ...infer Rest,
]
  ? [CompletedJobSequence<First>, ...MapToCompletedSequences<Rest>]
  : TBlockers extends (infer TElement extends JobSequence<any, any, any, any>)[]
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
  TSequenceTypeName extends keyof ExternalJobTypeDefinitions<TJobTypeDefinitions> & string,
> = {
  [K in SequenceJobTypes<TJobTypeDefinitions, TSequenceTypeName> &
    keyof TJobTypeDefinitions]: JobOf<TJobId, TJobTypeDefinitions, K, TSequenceTypeName>;
}[SequenceJobTypes<TJobTypeDefinitions, TSequenceTypeName> & keyof TJobTypeDefinitions];
