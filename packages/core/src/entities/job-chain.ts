import { StateJob } from "../state-adapter/state-adapter.js";
import { BaseQueueDefinitions, queueRefSymbol } from "./queue.js";

type MemberCompatibleTargets<TQueueDefinitions extends BaseQueueDefinitions, Out> = Out extends {
  [queueRefSymbol]: infer Ref;
}
  ? Extract<Ref, keyof TQueueDefinitions>
  : {
      [K in keyof TQueueDefinitions]: Out extends TQueueDefinitions[K]["input"]
        ? TQueueDefinitions[K]["input"] extends Out
          ? K
          : never
        : never;
    }[keyof TQueueDefinitions];

export type CompatibleQueueTargets<
  TQueueDefinitions extends BaseQueueDefinitions,
  From extends keyof TQueueDefinitions,
> = TQueueDefinitions[From]["output"] extends infer Out
  ? MemberCompatibleTargets<TQueueDefinitions, Out>
  : never;

type ReachableQueues<
  TQueueDefinitions extends BaseQueueDefinitions,
  From extends keyof TQueueDefinitions,
  Visited extends keyof TQueueDefinitions = never,
> = From extends Visited
  ? never
  :
      | From
      | {
          [K in CompatibleQueueTargets<TQueueDefinitions, From>]: ReachableQueues<
            TQueueDefinitions,
            K,
            Visited | From
          >;
        }[CompatibleQueueTargets<TQueueDefinitions, From>];

type NonInternalReachableQueues<
  TQueueDefinitions extends BaseQueueDefinitions,
  Start extends keyof TQueueDefinitions,
> = {
  [Q in ReachableQueues<TQueueDefinitions, Start> & keyof TQueueDefinitions]: Q;
}[ReachableQueues<TQueueDefinitions, Start> & keyof TQueueDefinitions];

type StripQueueRefs<T> = Exclude<T, { [queueRefSymbol]: any }>;

export type ResolvedJobChain<
  TQueueDefinitions extends BaseQueueDefinitions,
  Start extends keyof TQueueDefinitions,
> = {
  [Q in NonInternalReachableQueues<TQueueDefinitions, Start> & keyof TQueueDefinitions]: JobChain<
    Start,
    TQueueDefinitions[Q]["input"],
    StripQueueRefs<TQueueDefinitions[Q]["output"]>
  >;
}[NonInternalReachableQueues<TQueueDefinitions, Start> & keyof TQueueDefinitions];

export type JobChain<TChainName, TInput, TOutput> = {
  id: string;
  originId: string | null;
  rootId: string;
  chainName: TChainName;
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
export type CompletedJobChain<TJobChain extends JobChain<any, any, any>> = TJobChain & {
  status: "completed";
};

export const mapStateJobPairToJobChain = (
  stateJobPair: [StateJob, StateJob | undefined],
): JobChain<any, any, any> => {
  return {
    id: stateJobPair[0].id,
    originId: stateJobPair[0].originId,
    rootId: stateJobPair[0].rootId,
    chainName: stateJobPair[0].queueName,
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
