import { z } from "zod";
import { Branded } from "./helpers/typescript.js";

export type JobId<QueueName extends string> = Branded<string, `job-id:${QueueName}`>;
export type Job<QueueName extends string, Input, Output> = {
  id: JobId<QueueName>;
  queueName: QueueName;
  input: Input;

  // TODO: should allow undefined as a result, so need to introduce distinction between no result and undefined result
  output?: Output;
};
export type Queue<QueueName extends string, Input, Output> = {
  name: QueueName;
  enqueue: (options: { input: Input }) => Promise<Job<QueueName, Input, Output>>;
};

export const createQueue = <QueueName extends string, InputSchema extends z.ZodType, Output>(options: {
  queueName: QueueName;
  inputSchema: InputSchema;
  handler: (handlerOptions: { input: z.infer<InputSchema> }) => Promise<Output>;
}): Queue<
  QueueName,
  z.infer<InputSchema>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Output extends Job<infer _, infer __, infer ChainOutput> ? ChainOutput : Output
> => {
  void options;

  return {
    name: options.queueName,
    enqueue: async ({ input }) => {
      // TODO: validate input against schema
      // TODO: validate inside a transaction

      return {
        id: 'job-id-placeholder' as JobId<QueueName>,
        queueName: options.queueName,
        input: input,
        output: undefined,
      };
    },
  };
};
