import { StateJob } from "../state-adapter/state-adapter.js";
import { BaseJobTypeDefinitions, continuationOutputSymbol } from "./job-type.js";

export type DeduplicationStrategy = "finalized" | "all";

export type DeduplicationOptions = {
  key: string;
  strategy?: DeduplicationStrategy;
  windowMs?: number;
};

type MemberCompatibleTargets<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  Out,
> = Out extends {
  [continuationOutputSymbol]: infer Ref;
}
  ? Extract<Ref, keyof TJobTypeDefinitions>
  : {
      [K in keyof TJobTypeDefinitions]: Out extends TJobTypeDefinitions[K]["input"]
        ? TJobTypeDefinitions[K]["input"] extends Out
          ? K
          : never
        : never;
    }[keyof TJobTypeDefinitions];

export type CompatibleJobTypeTargets<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  From extends keyof TJobTypeDefinitions,
> = TJobTypeDefinitions[From]["output"] extends infer Out
  ? MemberCompatibleTargets<TJobTypeDefinitions, Out>
  : never;

type ReachableJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  From extends keyof TJobTypeDefinitions,
  Visited extends keyof TJobTypeDefinitions = never,
> = From extends Visited
  ? never
  :
      | From
      | {
          [K in CompatibleJobTypeTargets<TJobTypeDefinitions, From>]: ReachableJobTypes<
            TJobTypeDefinitions,
            K,
            Visited | From
          >;
        }[CompatibleJobTypeTargets<TJobTypeDefinitions, From>];

type NonInternalReachableJobTypes<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  Start extends keyof TJobTypeDefinitions,
> = {
  [Q in ReachableJobTypes<TJobTypeDefinitions, Start> & keyof TJobTypeDefinitions]: Q;
}[ReachableJobTypes<TJobTypeDefinitions, Start> & keyof TJobTypeDefinitions];

type StripContinuationOutputs<T> = Exclude<T, { [continuationOutputSymbol]: any }>;

export type ResolvedJobSequence<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  Start extends keyof TJobTypeDefinitions,
> = {
  [Q in NonInternalReachableJobTypes<TJobTypeDefinitions, Start> &
    keyof TJobTypeDefinitions]: JobSequence<
    Start,
    TJobTypeDefinitions[Q]["input"],
    StripContinuationOutputs<TJobTypeDefinitions[Q]["output"]>
  >;
}[NonInternalReachableJobTypes<TJobTypeDefinitions, Start> & keyof TJobTypeDefinitions];

export type JobSequence<TFirstJobTypeName, TInput, TOutput> = {
  id: string;
  originId: string | null;
  rootId: string;
  firstJobTypeName: TFirstJobTypeName;
  input: TInput;
  createdAt: Date;
} & (
  | { status: "created" }
  | { status: "blocked" }
  | { status: "pending" }
  | { status: "running" }
  | {
      status: "completed";
      output: TOutput;
      completedAt: Date;
    }
);
export type CompletedJobSequence<TJobSequence extends JobSequence<any, any, any>> = TJobSequence & {
  status: "completed";
};

export const mapStateJobPairToJobSequence = (
  stateJobPair: [StateJob, StateJob | undefined],
): JobSequence<any, any, any> => {
  const [firstJob, currentJob] = stateJobPair;
  const effectiveJob = currentJob ?? firstJob;

  const base = {
    id: firstJob.id,
    originId: firstJob.originId,
    rootId: firstJob.rootId,
    firstJobTypeName: firstJob.typeName,
    input: firstJob.input,
    createdAt: firstJob.createdAt,
  };

  switch (effectiveJob.status) {
    case "completed":
      return {
        ...base,
        status: "completed",
        output: effectiveJob.output,
        completedAt: effectiveJob.completedAt!,
      };
    case "running":
      return { ...base, status: "running" };
    case "pending":
      return { ...base, status: "pending" };
    case "blocked":
      return { ...base, status: "blocked" };
    default:
      return { ...base, status: "created" };
  }
};
