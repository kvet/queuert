import { DbJob } from "../sql.js";

export type JobChain<TChainName, TInput, TOutput> = {
  id: string;
  chainName: TChainName;
  input: TInput;
  createdAt: Date;
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

export const mapDbJobToJobChain = (dbJob: DbJob): JobChain<any, any, any> => {
  return {
    id: dbJob.id,
    chainName: dbJob.queue_name, // TODO
    input: dbJob.input,
    createdAt: new Date(dbJob.created_at),
    ...(dbJob.status === "completed"
      ? {
          status: "finished",
          output: dbJob.output,
          finishedAt: new Date(dbJob.completed_at!),
        }
      : {
          status: "started",
        }),
  };
};
