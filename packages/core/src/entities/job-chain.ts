import { StateJob } from "../state-adapter/state-adapter.js";

export type JobChain<TChainName, TInput, TOutput> = {
  id: string;
  chainName: TChainName;
  input: TInput;
  startedAt: Date;
} & (
  | {
      status: "started";
    }
  | {
      status: "finished";
      output: TOutput;
      finishedAt: Date;
    }
);
export type FinishedJobChain<TJobChain extends JobChain<any, any, any>> =
  TJobChain & { status: "finished" };

export const mapStateJobChainToJobChain = (
  stateJobChain: [StateJob, StateJob | undefined]
): JobChain<any, any, any> => {
  return {
    id: stateJobChain[0].id,
    chainName: stateJobChain[0].queueName,
    input: stateJobChain[0].input,
    startedAt: stateJobChain[0].createdAt,
    ...(stateJobChain[1]?.status === "completed"
      ? {
          status: "finished",
          output: stateJobChain[1].output,
          finishedAt: stateJobChain[1].completedAt!,
        }
      : {
          status: "started",
        }),
  };
};
