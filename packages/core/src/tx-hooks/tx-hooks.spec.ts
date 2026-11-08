import { describe, expect, test, vi } from "vitest";

import { createTxHooks, withTxHooks } from "./tx-hooks.ts";

const createRecorder = () => {
  const calls: string[] = [];
  return {
    calls,
    record: (label: string) => () => {
      calls.push(label);
    },
  };
};

const rerunAsync = async <T>(tries: number, cb: (tryIndex: number) => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let tryIndex = 1; tryIndex <= tries; tryIndex++) {
    try {
      return await cb(tryIndex);
    } catch (error) {
      lastError = error;
    }
  }
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
  throw lastError;
};

describe("TxHooks", () => {
  test("onCommit: runs commit callbacks in registration order after the callback returns", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      txHooks.onCommit(record("first"));
      txHooks.onCommit(record("second"));
      expect(calls).toEqual([]);
    });

    expect(calls).toEqual(["first", "second"]);
  });

  test("onCommit: awaits async commit callbacks", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      txHooks.onCommit(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        record("slow")();
      });
      txHooks.onCommit(async () => {
        record("fast")();
      });
    });

    expect(calls).toEqual(["fast", "slow"]);
  });

  test("onCommit: runs every commit callback even if one throws, then rethrows the first error", async () => {
    const after = vi.fn();
    const error = new Error("commit callback failed");

    await expect(
      withTxHooks(async (txHooks) => {
        txHooks.onCommit(() => {
          throw error;
        });
        txHooks.onCommit(async () => {
          throw new Error("second failure");
        });
        txHooks.onCommit(after);
      }),
    ).rejects.toThrow(error);

    expect(after).toHaveBeenCalledOnce();
  });

  test("onRollback: rollback callbacks do not run on commit", async () => {
    const rollback = vi.fn();

    await withTxHooks(async (txHooks) => {
      txHooks.onRollback(rollback);
    });

    expect(rollback).not.toHaveBeenCalled();
  });
});

describe("withTxHooks", () => {
  test("returns callback result on success", async () => {
    const result = await withTxHooks(async () => 42);
    expect(result).toBe(42);
  });

  test("propagates callback error", async () => {
    const error = new Error("boom");
    await expect(
      withTxHooks(async () => {
        throw error;
      }),
    ).rejects.toThrow(error);
  });

  test("drops commit callbacks and runs rollback callbacks newest first when the callback throws", async () => {
    const { calls, record } = createRecorder();

    await expect(
      withTxHooks(async (txHooks) => {
        txHooks.onCommit(record("commit"));
        txHooks.onRollback(record("rollback-first"));
        txHooks.onRollback(record("rollback-second"));
        throw new Error("transaction failed");
      }),
    ).rejects.toThrow("transaction failed");

    expect(calls).toEqual(["rollback-second", "rollback-first"]);
  });

  test("discard: runs every rollback callback even if one throws, then rethrows the original error", async () => {
    const remaining = vi.fn();
    const txError = new Error("transaction failed");

    await expect(
      withTxHooks(async (txHooks) => {
        txHooks.onRollback(remaining);
        txHooks.onRollback(() => {
          throw new Error("rollback callback failed");
        });
        throw txError;
      }),
    ).rejects.toThrow(txError);

    expect(remaining).toHaveBeenCalledOnce();
  });
});

describe("createTxHooks", () => {
  test("manual lifecycle - flush runs commit callbacks", async () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooks();
    txHooks.onCommit(record("commit"));
    txHooks.onRollback(record("rollback"));

    await flush();

    expect(calls).toEqual(["commit"]);
  });

  test("manual lifecycle - discard runs rollback callbacks", () => {
    const { calls, record } = createRecorder();
    const { txHooks, discard } = createTxHooks();
    txHooks.onCommit(record("commit"));
    txHooks.onRollback(record("rollback"));

    discard();

    expect(calls).toEqual(["rollback"]);
  });

  test("manual lifecycle - discard runs every rollback callback, then rethrows the first error", () => {
    const remaining = vi.fn();
    const error = new Error("rollback callback failed");
    const { txHooks, discard } = createTxHooks();
    txHooks.onRollback(remaining);
    txHooks.onRollback(() => {
      throw error;
    });

    expect(() => {
      discard();
    }).toThrow(error);
    expect(remaining).toHaveBeenCalledOnce();
  });

  test("manual lifecycle - discard does not leave a rejected promise from a rollback callback unhandled", async () => {
    const onUnhandledRejection = vi.fn();
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      const { txHooks, discard } = createTxHooks();
      // oxlint-disable-next-line typescript/no-misused-promises -- asserts that a misused async rollback callback is silenced
      txHooks.onRollback(async () => {
        throw new Error("async rollback callback failed");
      });

      discard();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});

describe("withSavepoint", () => {
  test("returns fn result on success and keeps its callbacks", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      const result = await txHooks.withSavepoint(async () => {
        txHooks.onCommit(record("inside"));
        txHooks.onRollback(record("rollback"));
        return 42;
      });
      expect(result).toBe(42);
    });

    expect(calls).toEqual(["inside"]);
  });

  test("drops commit callbacks and runs rollback callbacks registered in fn when fn throws", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      txHooks.onCommit(record("commit-before"));
      txHooks.onRollback(record("rollback-before"));

      await expect(
        txHooks.withSavepoint(async () => {
          txHooks.onCommit(record("commit-inside"));
          txHooks.onRollback(record("rollback-inside"));
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(calls).toEqual(["rollback-inside"]);
    });

    expect(calls).toEqual(["rollback-inside", "commit-before"]);
  });

  test("passes the same txHooks instance to the callback", async () => {
    await withTxHooks(async (txHooks) => {
      await txHooks.withSavepoint(async (inner) => {
        expect(inner).toBe(txHooks);
      });
    });
  });

  test("nested savepoints: inner rollback does not affect outer callbacks", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      txHooks.onCommit(record("a"));
      await txHooks.withSavepoint(async () => {
        txHooks.onCommit(record("b"));
        await expect(
          txHooks.withSavepoint(async () => {
            txHooks.onCommit(record("c"));
            throw new Error("inner");
          }),
        ).rejects.toThrow("inner");
      });
    });

    expect(calls).toEqual(["a", "b"]);
  });

  test("nested savepoints: outer rollback also rolls back a released inner savepoint", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      txHooks.onCommit(record("a"));
      await expect(
        txHooks.withSavepoint(async () => {
          txHooks.onCommit(record("b"));
          await txHooks.withSavepoint(async () => {
            txHooks.onCommit(record("c"));
            txHooks.onRollback(record("rollback-c"));
          });
          throw new Error("outer");
        }),
      ).rejects.toThrow("outer");
    });

    expect(calls).toEqual(["rollback-c", "a"]);
  });
});

describe("createSavepoint", () => {
  test("rollback drops commit callbacks and runs rollback callbacks registered after the savepoint", async () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooks();

    txHooks.onCommit(record("event-1"));
    const sp = txHooks.createSavepoint();
    txHooks.onCommit(record("event-2-bad"));
    txHooks.onRollback(record("undo-event-2"));
    sp.rollback();
    txHooks.onCommit(record("event-3"));
    await flush();

    expect(calls).toEqual(["undo-event-2", "event-1", "event-3"]);
  });

  test("release keeps callbacks, so a later discard runs their rollback callbacks", () => {
    const { calls, record } = createRecorder();
    const { txHooks, discard } = createTxHooks();

    const sp = txHooks.createSavepoint();
    txHooks.onRollback(record("promoted"));
    sp.release();
    discard();

    expect(calls).toEqual(["promoted"]);
  });

  test("returns the same txHooks instance", () => {
    const { txHooks } = createTxHooks();
    const sp = txHooks.createSavepoint();
    expect(sp.txHooks).toBe(txHooks);
  });

  test("rolling back again rolls back what was registered since the first rollback", async () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooks();

    txHooks.onCommit(record("a"));
    const sp = txHooks.createSavepoint();
    txHooks.onCommit(record("b"));
    sp.rollback();
    txHooks.onCommit(record("c"));
    sp.rollback();
    await flush();

    expect(calls).toEqual(["a"]);
  });

  test("rollback after release still rolls back", async () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooks();

    const sp = txHooks.createSavepoint();
    txHooks.onCommit(record("b"));
    sp.release();
    sp.rollback();
    await flush();

    expect(calls).toEqual([]);
  });

  test("rollback runs every rollback callback even if one throws", () => {
    const remaining = vi.fn();
    const { txHooks } = createTxHooks();

    const sp = txHooks.createSavepoint();
    txHooks.onRollback(remaining);
    txHooks.onRollback(() => {
      throw new Error("rollback callback failed");
    });
    sp.rollback();

    expect(remaining).toHaveBeenCalledOnce();
  });

  test("rolled-back rollback callbacks do not run again on discard", () => {
    const rollback = vi.fn();
    const { txHooks, discard } = createTxHooks();

    const sp = txHooks.createSavepoint();
    txHooks.onRollback(rollback);
    sp.rollback();
    discard();

    expect(rollback).toHaveBeenCalledOnce();
  });
});

describe("after flush or discard", () => {
  const settledError = new Error(
    "txHooks were already flushed or discarded; open new tx hooks for a new transaction",
  );

  test("registering a callback after flush throws", async () => {
    const { txHooks, flush } = createTxHooks();
    await flush();

    expect(() => {
      txHooks.onCommit(() => {});
    }).toThrow(settledError);
    expect(() => {
      txHooks.onRollback(() => {});
    }).toThrow(settledError);
  });

  test("savepoints and retryBoundary tries throw after flush", async () => {
    const { txHooks, flush } = createTxHooks();
    const runTry = txHooks.retryBoundary(async () => {});
    await flush();

    expect(() => txHooks.createSavepoint()).toThrow(settledError);
    await expect(txHooks.withSavepoint(async () => {})).rejects.toThrow(settledError);
    await expect(runTry()).rejects.toThrow(settledError);
  });

  test("rolling back a savepoint after flush does nothing", async () => {
    const rollback = vi.fn();
    const { txHooks, flush } = createTxHooks();
    const sp = txHooks.createSavepoint();
    txHooks.onRollback(rollback);
    await flush();

    sp.rollback();

    expect(rollback).not.toHaveBeenCalled();
  });

  test("savepoints and retryBoundary tries throw after discard, and an earlier savepoint's rollback does nothing", async () => {
    const rollback = vi.fn();
    const { txHooks, discard } = createTxHooks();
    const runTry = txHooks.retryBoundary(async () => {});
    const sp = txHooks.createSavepoint();
    txHooks.onRollback(rollback);
    discard();

    expect(() => txHooks.createSavepoint()).toThrow(settledError);
    await expect(txHooks.withSavepoint(async () => {})).rejects.toThrow(settledError);
    await expect(runTry()).rejects.toThrow(settledError);
    sp.rollback();
    expect(rollback).toHaveBeenCalledOnce();
  });

  test("flushing after discard and discarding after flush do nothing", async () => {
    const { calls, record } = createRecorder();
    const flushed = createTxHooks();
    flushed.txHooks.onRollback(record("rollback"));
    const discarded = createTxHooks();
    discarded.txHooks.onCommit(record("commit"));

    await flushed.flush();
    flushed.discard();
    discarded.discard();
    await discarded.flush();

    expect(calls).toEqual([]);
  });
});

describe("rollback order", () => {
  test("rolling back an outer savepoint makes a later inner rollback a no-op", async () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooks();

    const outer = txHooks.createSavepoint();
    txHooks.onRollback(record("rollback"));
    const inner = txHooks.createSavepoint();
    outer.rollback();
    txHooks.onCommit(record("after-outer-rollback"));
    inner.rollback();
    await flush();

    expect(calls).toEqual(["rollback", "after-outer-rollback"]);
  });

  test("a retryBoundary rerun after its enclosing savepoint rolled back does not roll back again", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      const runTry = txHooks.retryBoundary(async (tryIndex: number) => {
        if (tryIndex === 1) throw new Error("serialization failure");
      });
      await txHooks
        .withSavepoint(async () => {
          txHooks.onRollback(record("rollback"));
          await runTry(1);
        })
        .catch(() => {});
      txHooks.onCommit(record("after-savepoint"));
      await runTry(2);
    });

    expect(calls).toEqual(["rollback", "after-savepoint"]);
  });
});

describe("retryBoundary", () => {
  test("rolls back the previous try on re-entry and keeps callbacks from before the first try", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      txHooks.onCommit(record("commit:before"));
      await rerunAsync(
        3,
        txHooks.retryBoundary(async (tryIndex: number) => {
          txHooks.onCommit(record(`commit:try-${tryIndex}`));
          txHooks.onRollback(record(`rollback:try-${tryIndex}`));
          if (tryIndex < 3) throw new Error("serialization failure");
        }),
      );
    });

    expect(calls).toEqual(["rollback:try-1", "rollback:try-2", "commit:before", "commit:try-3"]);
  });

  test("undoes a try that failed after fn returned", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      const runTry = txHooks.retryBoundary(async (tryIndex: number) => {
        txHooks.onCommit(record(`try-${tryIndex}`));
      });
      await rerunAsync(2, async (tryIndex) => {
        await runTry(tryIndex);
        if (tryIndex === 1) throw new Error("commit failed");
      });
    });

    expect(calls).toEqual(["try-2"]);
  });

  test("forwards the driver's arguments and returns fn's result", async () => {
    await withTxHooks(async (txHooks) => {
      const wrapped = txHooks.retryBoundary(
        async (session: string, tryIndex: number) => `${session}:${tryIndex}`,
      );
      expect(await wrapped("session", 1)).toBe("session:1");
    });
  });

  test("throws when called while the previous try is still running", async () => {
    await withTxHooks(async (txHooks) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      const wrapped = txHooks.retryBoundary(async () => promise);
      const first = wrapped();
      await expect(wrapped()).rejects.toThrow(
        "txHooks.retryBoundary: the previous try is still running",
      );
      resolve();
      await first;
      await wrapped();
    });
  });

  test("supports withSavepoint inside a try", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      await rerunAsync(
        2,
        txHooks.retryBoundary(async (tryIndex: number) => {
          txHooks.onCommit(record(`try-${tryIndex}`));
          await txHooks
            .withSavepoint(async () => {
              txHooks.onCommit(record(`savepoint-${tryIndex}`));
              throw new Error("savepoint rolled back");
            })
            .catch(() => {});
          if (tryIndex === 1) throw new Error("serialization failure");
        }),
      );
    });

    expect(calls).toEqual(["try-2"]);
  });
});
