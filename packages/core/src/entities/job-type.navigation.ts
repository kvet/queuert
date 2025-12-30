import { CompletedJobSequence, JobSequence } from "./job-sequence.types.js";
import {
  BaseJobTypeDefinitions,
  blockerSymbol,
  continuationInputSymbol,
  continuationOutputSymbol,
} from "./job-type.js";
import { CreatedJob, Job, JobWithoutBlockers } from "./job.js";

export type FirstJobTypeDefinitions<T extends BaseJobTypeDefinitions> = {
  [K in keyof T as T[K]["input"] extends { [continuationInputSymbol]: true } ? never : K]: T[K];
};

type UnwrapContinuationInput<T> = T extends {
  [continuationInputSymbol]: true;
  $inputType: infer U;
}
  ? U
  : T;

export type JobOf<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = Job<
  TJobTypeName,
  UnwrapContinuationInput<TJobTypeDefinitions[TJobTypeName]["input"]>,
  CompletedBlockerSequences<TJobTypeDefinitions, TJobTypeName & string>
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

export type ContinuationJobs<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions & string,
> = {
  [K in ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>]: CreatedJob<
    JobWithoutBlockers<JobOf<TJobTypeDefinitions, K>>
  >;
}[ContinuationJobTypes<TJobTypeDefinitions, TJobTypeName>];

type StripContinuationOutputs<T> = Exclude<T, { [continuationOutputSymbol]: any }>;

export type JobSequenceOf<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = {
  [K in SequenceJobTypes<TJobTypeDefinitions, TJobTypeName> &
    keyof TJobTypeDefinitions]: JobSequence<
    TJobTypeName,
    UnwrapContinuationInput<TJobTypeDefinitions[K]["input"]>,
    StripContinuationOutputs<TJobTypeDefinitions[K]["output"]>
  >;
}[SequenceJobTypes<TJobTypeDefinitions, TJobTypeName> & keyof TJobTypeDefinitions];

type BlockerSequenceOf<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockerSpec,
> = TBlockerSpec extends { [blockerSymbol]: infer TName }
  ? TName extends keyof FirstJobTypeDefinitions<TJobTypeDefinitions> & string
    ? JobSequenceOf<TJobTypeDefinitions, TName>
    : never
  : TBlockerSpec extends object
    ? {
        [K in keyof FirstJobTypeDefinitions<TJobTypeDefinitions>]: TJobTypeDefinitions[K]["input"] extends TBlockerSpec
          ? TBlockerSpec extends TJobTypeDefinitions[K]["input"]
            ? JobSequenceOf<TJobTypeDefinitions, K>
            : never
          : never;
      }[keyof FirstJobTypeDefinitions<TJobTypeDefinitions>]
    : never;

type MapBlockerSequences<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockers,
> = TBlockers extends readonly [infer First, ...infer Rest]
  ? [
      BlockerSequenceOf<TJobTypeDefinitions, First>,
      ...MapBlockerSequences<TJobTypeDefinitions, Rest>,
    ]
  : TBlockers extends readonly (infer TElement)[]
    ? BlockerSequenceOf<TJobTypeDefinitions, TElement>[]
    : [];

export type BlockerSequences<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = TJobTypeDefinitions[TJobTypeName] extends { blockers: infer TBlockers }
  ? MapBlockerSequences<TJobTypeDefinitions, TBlockers>
  : [];

export type HasBlockers<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = BlockerSequences<TJobTypeDefinitions, TJobTypeName> extends [] ? false : true;

type MapToCompletedSequences<TBlockers> = TBlockers extends [
  infer First extends JobSequence<any, any, any>,
  ...infer Rest,
]
  ? [CompletedJobSequence<First>, ...MapToCompletedSequences<Rest>]
  : TBlockers extends (infer TElement extends JobSequence<any, any, any>)[]
    ? CompletedJobSequence<TElement>[]
    : [];

export type CompletedBlockerSequences<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends keyof TJobTypeDefinitions,
> = MapToCompletedSequences<BlockerSequences<TJobTypeDefinitions, TJobTypeName>>;

export type SequenceJobs<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TFirstJobTypeName extends string,
> = {
  [K in SequenceJobTypes<TJobTypeDefinitions, TFirstJobTypeName> &
    keyof TJobTypeDefinitions]: JobOf<TJobTypeDefinitions, K>;
}[SequenceJobTypes<TJobTypeDefinitions, TFirstJobTypeName> & keyof TJobTypeDefinitions];
