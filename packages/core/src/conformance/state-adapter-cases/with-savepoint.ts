import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const withSavepointGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "withSavepoint",
  cases: [
    {
      name: "commits changes on success",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) => {
          const results = await stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "sp-test",
                chainTypeName: "sp-test",
                input: null,
              },
            ],
          });

          await stateAdapter.withSavepoint(txCtx, async (spTxCtx) => {
            await stateAdapter.finishJobAttempt({
              txCtx: spTxCtx,
              jobId: results[0].job.id,
              workerId: null,
              outcome: { output: { done: true } },
            });
          });

          return results;
        });

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [job.id] });
        expect(retrieved?.completedAt).toBeInstanceOf(Date);
        expect(retrieved?.output).toEqual({ done: true });
      },
    },
    {
      name: "rolls back changes on error",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) => {
          const results = await stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "sp-rollback",
                chainTypeName: "sp-rollback",
                input: null,
              },
            ],
          });

          await stateAdapter
            .withSavepoint(txCtx, async (spTxCtx) => {
              await stateAdapter.finishJobAttempt({
                txCtx: spTxCtx,
                jobId: results[0].job.id,
                workerId: null,
                outcome: { output: { done: true } },
              });
              throw new Error("simulated failure");
            })
            .catch(() => {});

          return results;
        });

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [job.id] });
        expect(retrieved?.completedAt).toBeNull();
        expect(retrieved?.attemptAt).toBeNull();
        expect(retrieved?.output).toBeNull();
      },
    },
    {
      name: "does not affect outer transaction on rollback",
      run: async ({ stateAdapter }, expect) => {
        const jobs = await stateAdapter.withTransaction(async (txCtx) => {
          const [{ job: job1 }] = await stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "sp-outer-1",
                chainTypeName: "sp-outer-1",
                input: { before: true },
              },
            ],
          });

          await stateAdapter
            .withSavepoint(txCtx, async (spTxCtx) => {
              await stateAdapter.createChains({
                txCtx: spTxCtx,
                jobs: [
                  {
                    typeName: "sp-inner",
                    chainTypeName: "sp-inner",
                    input: { inside: true },
                  },
                ],
              });
              throw new Error("savepoint failure");
            })
            .catch(() => {});

          const [{ job: job2 }] = await stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "sp-outer-2",
                chainTypeName: "sp-outer-2",
                input: { after: true },
              },
            ],
          });

          return [job1, job2];
        });

        const [job1] = await stateAdapter.getJobs({ jobIds: [jobs[0].id] });
        const [job2] = await stateAdapter.getJobs({ jobIds: [jobs[1].id] });
        expect(job1).toBeDefined();
        expect(job1?.input).toEqual({ before: true });
        expect(job2).toBeDefined();
        expect(job2?.input).toEqual({ after: true });
      },
    },
    {
      name: "supports nested savepoints",
      run: async ({ stateAdapter }, expect) => {
        const [{ job }] = await stateAdapter.withTransaction(async (txCtx) => {
          const results = await stateAdapter.createChains({
            txCtx,
            jobs: [
              {
                typeName: "sp-nested",
                chainTypeName: "sp-nested",
                input: { step: 0 },
              },
            ],
          });
          const jobId = results[0].job.id;

          await stateAdapter.withSavepoint(txCtx, async (spTxCtx) => {
            await stateAdapter.finishJobAttempt({
              txCtx: spTxCtx,
              jobId,
              workerId: null,
              outcome: { output: { step: 1 } },
            });

            await stateAdapter
              .withSavepoint(spTxCtx, async (sp2TxCtx) => {
                await stateAdapter.finishJobAttempt({
                  txCtx: sp2TxCtx,
                  jobId,
                  workerId: null,
                  outcome: { error: "inner failure", schedule: { afterMs: 5000 } },
                });
                throw new Error("inner savepoint failure");
              })
              .catch(() => {});
          });

          return results;
        });

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [job.id] });
        expect(retrieved?.completedAt).toBeInstanceOf(Date);
        expect(retrieved?.output).toEqual({ step: 1 });
      },
    },
    {
      name: "re-throws the original error",
      run: async ({ stateAdapter }, expect) => {
        await stateAdapter.withTransaction(async (txCtx) => {
          await expect(
            stateAdapter.withSavepoint(txCtx, async () => {
              throw new Error("original error");
            }),
          ).rejects.toThrow("original error");
        });
      },
    },
    {
      name: "isolates poisoned transaction so outer transaction can continue",
      run: async ({ stateAdapter, poisonTransaction }, expect) => {
        if (!poisonTransaction) {
          expect.skip(
            "requires poisonTransaction hook (backend does not support mid-tx poisoning)",
          );
          return;
        }
        const poison = poisonTransaction;

        const [{ job: jobBefore }, { job: jobAfter }] = await stateAdapter.withTransaction(
          async (txCtx) => {
            const [{ job: jobBefore }] = await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "sp-poison-before",
                  chainTypeName: "sp-poison-before",
                  input: null,
                },
              ],
            });

            await stateAdapter
              .withSavepoint(txCtx, async (spTxCtx) => {
                await poison(spTxCtx);
              })
              .catch(() => {});

            const [{ job: jobAfter }] = await stateAdapter.createChains({
              txCtx,
              jobs: [
                {
                  typeName: "sp-poison-after",
                  chainTypeName: "sp-poison-after",
                  input: null,
                },
              ],
            });

            return [{ job: jobBefore }, { job: jobAfter }];
          },
        );

        const [before] = await stateAdapter.getJobs({ jobIds: [jobBefore.id] });
        const [after] = await stateAdapter.getJobs({ jobIds: [jobAfter.id] });
        expect(before).toBeDefined();
        expect(after).toBeDefined();
      },
    },
  ],
};
