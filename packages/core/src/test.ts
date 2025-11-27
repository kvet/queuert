type CompatibleQueueTargets<
  TQueueDefinitions extends BaseQueueDefinitions,
  From extends keyof TQueueDefinitions
> = {
  [K in keyof TQueueDefinitions]: TQueueDefinitions[From]["output"] extends TQueueDefinitions[K]["input"]
    ? K
    : never;
}[keyof TQueueDefinitions];

type ReachableQueues<
  TQueueDefinitions extends BaseQueueDefinitions,
  From extends keyof TQueueDefinitions,
  Visited extends keyof TQueueDefinitions = never
> = From extends Visited
  ? never
  :
      | From
      | {
          [K in CompatibleQueueTargets<
            TQueueDefinitions,
            From
          >]: ReachableQueues<TQueueDefinitions, K, Visited | From>;
        }[CompatibleQueueTargets<TQueueDefinitions, From>];

type JobChainResult<
  TQueueDefinitions extends BaseQueueDefinitions,
  Start extends keyof TQueueDefinitions
> = {
  [Q in ReachableQueues<TQueueDefinitions, Start> & keyof TQueueDefinitions]: {
    queueName: Q;
    output: TQueueDefinitions[Q]["output"];
  };
}[ReachableQueues<TQueueDefinitions, Start> & keyof TQueueDefinitions];

const createQueuert = () => {
  return {
    defineQueues<TQueueDefinitions extends BaseQueueDefinitions>() {
      // Capture API in a const so defineHandler can return it
      const api = {
        defineHandler<
          TQueueName extends keyof TQueueDefinitions & string
        >(options: {
          name: TQueueName;
          handler: (options: {
            enqueueJob: (options: {
              queueName: CompatibleQueueTargets<TQueueDefinitions, TQueueName> &
                string;
              // payload?: TQueueDefinitions[typeof options.queueName]["input"];
            }) => void;
          }) => void;
        }) {
          // no runtime logic here for now
          return api;
        },

        enqueueChain<
          TQueueName extends keyof TQueueDefinitions & string
        >(options: {
          queueName: TQueueName;
          input: TQueueDefinitions[TQueueName]["input"];
        }) {
          // You can make this async if you really want `await` here:
          // return Promise.resolve({ ... })
          return {
            async result() {
              // stubbed runtime; type is what matters
              return null as any as JobChainResult<
                TQueueDefinitions,
                TQueueName
              >;
            },
          };
        },
      };

      return api;
    },
  };
};

import { expectTypeOf } from "vitest";
import { BaseQueueDefinitions } from "./entities/queue.js";

const queuert = createQueuert().defineQueues<{
  emailQueue: { input: { to: string }; output: { messageId: string } };
  smsQueue: { input: { phoneNumber: string }; output: { messageId: string } };
  reportQueue: { input: { messageId: string }; output: { status: string } };
}>();

const worker = queuert.defineHandler({
  name: "emailQueue",
  handler: ({ enqueueJob }) => {
    enqueueJob({ queueName: "reportQueue" }); // ✅ allowed
    // enqueueJob({ queueName: "smsQueue" }); // ❌ as desired
  },
});

const client = queuert.enqueueChain({
  queueName: "emailQueue",
  input: { to: "example@example.com" },
});

const result = await client.result();

expectTypeOf(result).toEqualTypeOf<
  | {
      queueName: "emailQueue";
      output: { messageId: string };
    }
  | {
      queueName: "reportQueue";
      output: { status: string };
    }
>();
