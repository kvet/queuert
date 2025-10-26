import { z } from 'zod';
import { test, expectTypeOf } from 'vitest'
import { createQueue, Job } from './index.js';

test('job result', async () => {
  const queue = createQueue({
    queueName: 'test-queue',
    inputSchema: z.object({
      value: z.number(),
    }),
    handler: async ({ input }) => {
      return { doubled: input.value * 2 };
    },
  });

  const job = await queue.enqueue({ input: { value: 5 } });
  expectTypeOf(job.output).toEqualTypeOf<undefined | { doubled: number }>();
});

test('linear pipeline', async () => {
  const linear1 = createQueue({
    queueName: 'linear-1',
    inputSchema: z.object({
      step1: z.string(),
    }),
    handler: async ({ input }) => {
      return await linear2.enqueue({ input: { step2: input.step1 + 'processed' } });
    },
  });

  const linear2 = createQueue({
    queueName: 'linear-2',
    inputSchema: z.object({
      step2: z.string(),
    }),
    handler: async ({ input }) => {
      return { step2Result: input.step2 + ' and done' };
    },
  });

  const job = await linear1.enqueue({ input: { step1: 'test' } });

  expectTypeOf(job.output).toEqualTypeOf<undefined | { step2Result: string }>();
});

test('branched pipeline with different terminations', async () => {
  const starting = createQueue({
    queueName: 'starting',
    inputSchema: z.object({
      value: z.number(),
    }),
    handler: async ({ input }) => {
      if (input.value % 2 === 0) {
        return await branchA.enqueue({ input: { fromStarting: input.value + 1 } });
      }
      return await branchB.enqueue({ input: { fromStarting: input.value + 2 } });
    },
  });

  const branchA = createQueue({
    queueName: 'branch-a',
    inputSchema: z.object({
      fromStarting: z.number(),
    }),
    handler: async ({ input }) => {
      return { resultA: input.fromStarting * 2 };
    },
  });

  const branchB = createQueue({
    queueName: 'branch-b',
    inputSchema: z.object({
      fromStarting: z.number(),
    }),
    handler: async ({ input }) => {
      return { resultB: input.fromStarting * 3 };
    },
  });

  const job = await starting.enqueue({ input: { value: 10 } });

  expectTypeOf(job.output).toEqualTypeOf<undefined | { resultA: number } | { resultB: number }>();
});

test('branched pipeline with a single termination', async () => {
  const starting = createQueue({
    queueName: 'starting',
    inputSchema: z.object({
      value: z.number(),
    }),
    handler: async ({ input }) => {
      if (input.value % 2 === 0) {
        return await branch.enqueue({ input: { branchValue: input.value + 1 } });
      }
      return await termination.enqueue({ input: { terminationValue: input.value + 2 } });
    },
  });

  const branch = createQueue({
    queueName: 'branch',
    inputSchema: z.object({
      branchValue: z.number(),
    }),
    handler: async ({ input }) => {
      return await termination.enqueue({ input: { terminationValue: input.branchValue * 2 } });
    },
  });

  const termination = createQueue({
    queueName: 'termination',
    inputSchema: z.object({
      terminationValue: z.number(),
    }),
    handler: async ({ input }) => {
      return { result: input.terminationValue * 3 };
    },
  });

  const job = await starting.enqueue({ input: { value: 10 } });

  expectTypeOf(job.output).toEqualTypeOf<undefined | { result: number }>();
});

test('looped pipeline', async () => {
  const loopQueue = createQueue({
    queueName: 'loop-queue',
    inputSchema: z.object({
      count: z.number(),
    }),
    handler: async ({ input }): Promise<{ result: number } | Job<'loop-queue', { count: number }, { result: number }>> => {
      if (input.count > 0) {
        return await loopQueue.enqueue({ input: { count: input.count - 1 } });
      }
      return { result: 0 };
    },
  });

  const job = await loopQueue.enqueue({ input: { count: 5 } });

  expectTypeOf(job.output).toEqualTypeOf<undefined | { result: number }>();
});

test('nested pipeline', async () => {
  const enterOuterQueue = createQueue({
    queueName: 'enter-outer-queue',
    inputSchema: z.object({
      value: z.string(),
    }),
    handler: async ({ input }) => {
      return await innerQueue.enqueue({ input: { innerValue: input.value.length } });
    },
  });

  const innerQueue = createQueue({
    queueName: 'inner-queue',
    inputSchema: z.object({
      innerValue: z.number(),
    }),
    handler: async ({ input }) => {
      return { innerValue: input.innerValue * 2 };
    },
  });

  const exitOuterQueue = createQueue({
    queueName: 'outer-queue',
    inputSchema: z.object({
      finalValue: z.number(),
    }),
    handler: async ({ input }) => {
      return { finalResult: input.finalValue + 10 };
    },
  });

  const job = await enterOuterQueue.enqueue({ input: { value: 'hello' } });

  expectTypeOf(job.output).toEqualTypeOf<undefined | { finalResult: number }>();
});
