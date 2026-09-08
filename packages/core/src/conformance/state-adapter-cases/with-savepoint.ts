import { type ConformanceGroup } from "../runner.js";
import { type StateConformanceFixture } from "./types.js";

export const withSavepointGroup: ConformanceGroup<StateConformanceFixture> = {
  name: "withSavepoint",
  cases: [
    {
      name: "commits changes on success",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) => {
          const results = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sp-test", input: null }],
          });

          await stateAdapter.withSavepoint(txCtx, async (spTxCtx) => {
            await stateAdapter.completeJobs({
              txCtx: spTxCtx,
              completedBy: null,
              jobs: [{ jobId: results[0].head.id, output: { done: true } }],
            });
          });

          return results;
        });

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(retrieved?.completedAt).toBeInstanceOf(Date);
        expect(retrieved?.output).toEqual({ done: true });
      },
    },
    {
      name: "rolls back changes on error",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) => {
          const results = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sp-rollback", input: null }],
          });

          await stateAdapter
            .withSavepoint(txCtx, async (spTxCtx) => {
              await stateAdapter.completeJobs({
                txCtx: spTxCtx,
                completedBy: null,
                jobs: [{ jobId: results[0].head.id, output: { done: true } }],
              });
              throw new Error("simulated failure");
            })
            .catch(() => {});

          return results;
        });

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(retrieved?.completedAt).toBeNull();
        expect(retrieved?.attemptAt).toBeNull();
        expect(retrieved?.output).toBeNull();
      },
    },
    {
      name: "does not affect outer transaction on rollback",
      run: async ({ stateAdapter }, expect) => {
        const jobs = await stateAdapter.withTransaction(async (txCtx) => {
          const [chain1] = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sp-outer-1", input: { before: true } }],
          });

          await stateAdapter
            .withSavepoint(txCtx, async (spTxCtx) => {
              await stateAdapter.createJobs({
                txCtx: spTxCtx,
                jobs: [{ typeName: "sp-inner", input: { inside: true } }],
              });
              throw new Error("savepoint failure");
            })
            .catch(() => {});

          const [chain2] = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sp-outer-2", input: { after: true } }],
          });

          return [chain1.head, chain2.head];
        });

        const [view1] = await stateAdapter.getJobs({ jobIds: [jobs[0].id] });
        const [view2] = await stateAdapter.getJobs({ jobIds: [jobs[1].id] });
        expect(view1).toBeDefined();
        expect(view1?.input).toEqual({ before: true });
        expect(view2).toBeDefined();
        expect(view2?.input).toEqual({ after: true });
      },
    },
    {
      name: "supports nested savepoints",
      run: async ({ stateAdapter }, expect) => {
        const [stateChain] = await stateAdapter.withTransaction(async (txCtx) => {
          const results = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sp-nested", input: { step: 0 } }],
          });
          const jobId = results[0].head.id;

          await stateAdapter.withSavepoint(txCtx, async (spTxCtx) => {
            await stateAdapter.completeJobs({
              txCtx: spTxCtx,
              completedBy: null,
              jobs: [{ jobId, output: { step: 1 } }],
            });

            await stateAdapter
              .withSavepoint(spTxCtx, async (sp2TxCtx) => {
                await stateAdapter.rescheduleJobs({
                  txCtx: sp2TxCtx,
                  jobs: [{ jobId, schedule: { afterMs: 5000 }, error: "inner failure" }],
                });
                throw new Error("inner savepoint failure");
              })
              .catch(() => {});
          });

          return results;
        });

        const [retrieved] = await stateAdapter.getJobs({ jobIds: [stateChain.head.id] });
        expect(retrieved?.completedAt).toBeInstanceOf(Date);
        expect(retrieved?.output).toEqual({ step: 1 });
      },
    },
    {
      name: "rolls back the whole parent savepoint after a nested savepoint succeeded",
      run: async ({ stateAdapter }, expect) => {
        let parentJobId: string;
        let nestedJobId: string;

        const [outerChain] = await stateAdapter.withTransaction(async (txCtx) => {
          const results = await stateAdapter.createJobs({
            txCtx,
            jobs: [
              {
                typeName: "sp-parent-outer",
                input: { outer: true },
              },
            ],
          });

          await stateAdapter
            .withSavepoint(txCtx, async (spTxCtx) => {
              const [parentChain] = await stateAdapter.createJobs({
                txCtx: spTxCtx,
                jobs: [
                  {
                    typeName: "sp-parent-body",
                    input: { parent: true },
                  },
                ],
              });
              parentJobId = parentChain.head.id;

              await stateAdapter.withSavepoint(spTxCtx, async (sp2TxCtx) => {
                const [nestedChain] = await stateAdapter.createJobs({
                  txCtx: sp2TxCtx,
                  jobs: [
                    {
                      typeName: "sp-parent-nested",
                      input: { nested: true },
                    },
                  ],
                });
                nestedJobId = nestedChain.head.id;
              });

              throw new Error("parent savepoint failure");
            })
            .catch(() => {});

          return results;
        });

        const [outer, parent, nested] = await stateAdapter.getJobs({
          jobIds: [outerChain.head.id, parentJobId!, nestedJobId!],
        });
        expect(outer?.id).toEqual(outerChain.head.id);
        expect(parent).toBeUndefined();
        expect(nested).toBeUndefined();
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

        const [beforeChain, afterChain] = await stateAdapter.withTransaction(async (txCtx) => {
          const [beforeChain] = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sp-poison-before", input: null }],
          });

          await stateAdapter
            .withSavepoint(txCtx, async (spTxCtx) => {
              await poison(spTxCtx);
            })
            .catch(() => {});

          const [afterChain] = await stateAdapter.createJobs({
            txCtx,
            jobs: [{ typeName: "sp-poison-after", input: null }],
          });

          return [beforeChain, afterChain];
        });

        const [before] = await stateAdapter.getJobs({ jobIds: [beforeChain.head.id] });
        const [after] = await stateAdapter.getJobs({ jobIds: [afterChain.head.id] });
        expect(before).toBeDefined();
        expect(after).toBeDefined();
      },
    },
  ],
};
