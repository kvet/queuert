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
  | {
      status: "created";
    }
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
  return {
    id: stateJobPair[0].id,
    originId: stateJobPair[0].originId,
    rootId: stateJobPair[0].rootId,
    firstJobTypeName: stateJobPair[0].typeName,
    input: stateJobPair[0].input,
    createdAt: stateJobPair[0].createdAt,
    ...(stateJobPair[1]?.status === "completed"
      ? {
          status: "completed",
          output: stateJobPair[1].output,
          completedAt: stateJobPair[1].completedAt!,
        }
      : {
          status: "created",
        }),
  };
};
