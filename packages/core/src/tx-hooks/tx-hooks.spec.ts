import { sleep } from "@queuert/helpers/sleep";
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

const rerun = async <T>(tries: number, cb: (tryIndex: number) => Promise<T>): Promise<T> => {
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

  test("onCommit: runs every commit callback even if one throws, then rethrows the first error", async () => {
    const after = vi.fn();
    const error = new Error("commit callback failed");

    await expect(async () => {
      await withTxHooks(async (txHooks) => {
        txHooks.onCommit(() => {
          throw error;
        });
        txHooks.onCommit(async () => {
          throw new Error("second failure");
        });
        txHooks.onCommit(after);
      });
    }).rejects.toThrow(error);

    expect(after).toHaveBeenCalledOnce();
  });

  test("onRollback: rollback callbacks do not run on commit", async () => {
    const rollback = vi.fn();

    await withTxHooks(async (txHooks) => {
      txHooks.onRollback(rollback);
    });

    expect(rollback).not.toHaveBeenCalled();
  });

  test("onCommit: awaits async commit callbacks", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      txHooks.onCommit(async () => {
        await sleep(10);
        record("slow")();
      });
      txHooks.onCommit(async () => {
        record("fast")();
      });
    });

    expect(calls).toEqual(["fast", "slow"]);
  });
});

describe("withTxHooks", () => {
  test("returns callback result on success", async () => {
    const result = await withTxHooks(async () => 42);
    expect(result).toBe(42);
  });

  test("propagates callback error", async () => {
    const error = new Error("boom");
    await expect(async () => {
      await withTxHooks(async () => {
        throw error;
      });
    }).rejects.toThrow(error);
  });

  test("drops commit callbacks and runs rollback callbacks newest first when the callback throws", async () => {
    const { calls, record } = createRecorder();

    await expect(async () => {
      await withTxHooks(async (txHooks) => {
        txHooks.onCommit(record("commit"));
        txHooks.onRollback(record("rollback-first"));
        txHooks.onRollback(record("rollback-second"));
        throw new Error("transaction failed");
      });
    }).rejects.toThrow("transaction failed");

    expect(calls).toEqual(["rollback-second", "rollback-first"]);
  });

  test("awaits async rollback callbacks before rejecting with the original error", async () => {
    const { calls, record } = createRecorder();
    const txError = new Error("transaction failed");

    await expect(async () => {
      await withTxHooks(async (txHooks) => {
        txHooks.onRollback(async () => {
          await sleep(10);
          record("rollback")();
        });
        txHooks.onRollback(async () => {
          throw new Error("rollback callback failed");
        });
        throw txError;
      });
    }).rejects.toThrow(txError);

    expect(calls).toEqual(["rollback"]);
  });

  test("discard: runs every rollback callback even if one throws, then rethrows the original error", async () => {
    const remaining = vi.fn();
    const txError = new Error("transaction failed");

    await expect(async () => {
      await withTxHooks(async (txHooks) => {
        txHooks.onRollback(remaining);
        txHooks.onRollback(() => {
          throw new Error("rollback callback failed");
        });
        throw txError;
      });
    }).rejects.toThrow(txError);

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

  test("manual lifecycle - flush throws synchronously when a synchronous commit callback throws", () => {
    const after = vi.fn();
    const error = new Error("commit callback failed");
    const { txHooks, flush } = createTxHooks();
    txHooks.onCommit(() => {
      throw error;
    });
    txHooks.onCommit(after);

    expect(() => flush()).toThrow(error);
    expect(after).toHaveBeenCalledOnce();
  });

  test("manual lifecycle - flush rejects with a synchronous error after awaiting async commit callbacks", async () => {
    const { calls, record } = createRecorder();
    const error = new Error("commit callback failed");
    const { txHooks, flush } = createTxHooks();
    txHooks.onCommit(async () => {
      await sleep(10);
      record("slow")();
    });
    txHooks.onCommit(() => {
      throw error;
    });

    await expect(flush()).rejects.toThrow(error);
    expect(calls).toEqual(["slow"]);
  });

  test("manual lifecycle - discard runs rollback callbacks", () => {
    const { calls, record } = createRecorder();
    const { txHooks, discard } = createTxHooks();
    txHooks.onCommit(record("commit"));
    txHooks.onRollback(record("rollback"));

    expect(discard()).toBeUndefined();
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

    expect(() => discard()).toThrow(error);
    expect(remaining).toHaveBeenCalledOnce();
  });

  test("manual lifecycle - discard returns nothing when every rollback callback is synchronous", () => {
    const { txHooks, discard } = createTxHooks();
    txHooks.onRollback(() => {});

    expect(discard()).toBeUndefined();
  });

  test("manual lifecycle - discard awaits async rollback callbacks and rejects with the first error", async () => {
    const { calls, record } = createRecorder();
    const error = new Error("async rollback callback failed");
    const { txHooks, discard } = createTxHooks();
    txHooks.onRollback(async () => {
      await sleep(10);
      record("slow")();
    });
    txHooks.onRollback(async () => {
      throw error;
    });

    await expect(discard()).rejects.toThrow(error);
    expect(calls).toEqual(["slow"]);
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

      await expect(async () => {
        await txHooks.withSavepoint(async () => {
          txHooks.onCommit(record("commit-inside"));
          txHooks.onRollback(record("rollback-inside"));
          throw new Error("boom");
        });
      }).rejects.toThrow("boom");

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
        await expect(async () => {
          await txHooks.withSavepoint(async () => {
            txHooks.onCommit(record("c"));
            throw new Error("inner");
          });
        }).rejects.toThrow("inner");
      });
    });

    expect(calls).toEqual(["a", "b"]);
  });

  test("nested savepoints: outer rollback also rolls back a released inner savepoint", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      txHooks.onCommit(record("a"));
      await expect(async () => {
        await txHooks.withSavepoint(async () => {
          txHooks.onCommit(record("b"));
          await txHooks.withSavepoint(async () => {
            txHooks.onCommit(record("c"));
            txHooks.onRollback(record("rollback-c"));
          });
          throw new Error("outer");
        });
      }).rejects.toThrow("outer");
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

  test("release keeps callbacks, so a later discard runs their rollback callbacks", async () => {
    const { calls, record } = createRecorder();
    const { txHooks, discard } = createTxHooks();

    const sp = txHooks.createSavepoint();
    txHooks.onRollback(record("promoted"));
    sp.release();
    await discard();

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

  test("rolled-back rollback callbacks do not run again on discard", async () => {
    const rollback = vi.fn();
    const { txHooks, discard } = createTxHooks();

    const sp = txHooks.createSavepoint();
    txHooks.onRollback(rollback);
    sp.rollback();
    await discard();

    expect(rollback).toHaveBeenCalledOnce();
  });
});

describe("after flush or discard", () => {
  const settledError = new Error(
    "txHooks were already flushed or discarded; open new tx hooks for a new transaction",
  );

  test("isOpen is true until flush or discard, through savepoint and retryBoundary rollbacks, and false in their callbacks", async () => {
    const flushed = createTxHooks();
    const seen: boolean[] = [];
    flushed.txHooks.onCommit(() => {
      seen.push(flushed.txHooks.isOpen);
    });
    flushed.txHooks.createSavepoint().rollback();
    const runTry = flushed.txHooks.retryBoundary(() => {});
    runTry();
    runTry();
    seen.push(flushed.txHooks.isOpen);
    await flushed.flush();
    seen.push(flushed.txHooks.isOpen);

    const discarded = createTxHooks();
    discarded.txHooks.onRollback(() => {
      seen.push(discarded.txHooks.isOpen);
    });
    await discarded.discard();
    seen.push(discarded.txHooks.isOpen);

    expect(seen).toEqual([true, false, false, false, false]);
  });

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
    await expect(async () => {
      await txHooks.withSavepoint(async () => {});
    }).rejects.toThrow(settledError);
    await expect(async () => {
      await runTry();
    }).rejects.toThrow(settledError);
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
    await discard();

    expect(() => txHooks.createSavepoint()).toThrow(settledError);
    await expect(async () => {
      await txHooks.withSavepoint(async () => {});
    }).rejects.toThrow(settledError);
    await expect(async () => {
      await runTry();
    }).rejects.toThrow(settledError);
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
    await flushed.discard();
    await discarded.discard();
    await discarded.flush();

    expect(calls).toEqual([]);
  });
});

describe("async rollback callbacks of a savepoint", () => {
  test("flush awaits them and ignores their rejections", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      const savepoint = txHooks.createSavepoint();
      txHooks.onRollback(async () => {
        await sleep(10);
        record("rollback")();
      });
      txHooks.onRollback(async () => {
        throw new Error("rollback callback failed");
      });
      savepoint.rollback();
      expect(calls).toEqual([]);
      txHooks.onCommit(record("commit"));
    });

    expect(calls).toEqual(["commit", "rollback"]);
  });

  test("discard awaits them and ignores their rejections", async () => {
    const { calls, record } = createRecorder();
    const txError = new Error("transaction failed");

    await expect(async () => {
      await withTxHooks(async (txHooks) => {
        await expect(async () => {
          await txHooks.withSavepoint(async () => {
            txHooks.onRollback(async () => {
              await sleep(10);
              record("savepoint-rollback")();
            });
            txHooks.onRollback(async () => {
              throw new Error("rollback callback failed");
            });
            throw new Error("savepoint rolled back");
          });
        }).rejects.toThrow("savepoint rolled back");
        throw txError;
      });
    }).rejects.toThrow(txError);

    expect(calls).toEqual(["savepoint-rollback"]);
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
      await expect(async () => {
        await txHooks.withSavepoint(async () => {
          txHooks.onRollback(record("rollback"));
          await runTry(1);
        });
      }).rejects.toThrow("serialization failure");
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
      await rerun(
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
      await rerun(2, async (tryIndex) => {
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
      const wrapped: () => Promise<void> = txHooks.retryBoundary(async () => {
        await expect(async () => {
          await wrapped();
        }).rejects.toThrow("txHooks.retryBoundary: the previous try is still running");
      });
      await wrapped();
    });
  });

  test("supports withSavepoint inside a try", async () => {
    const { calls, record } = createRecorder();

    await withTxHooks(async (txHooks) => {
      await rerun(
        2,
        txHooks.retryBoundary(async (tryIndex: number) => {
          txHooks.onCommit(record(`try-${tryIndex}`));
          await expect(async () => {
            await txHooks.withSavepoint(async () => {
              txHooks.onCommit(record(`savepoint-${tryIndex}`));
              throw new Error("savepoint rolled back");
            });
          }).rejects.toThrow("savepoint rolled back");
          if (tryIndex === 1) throw new Error("serialization failure");
        }),
      );
    });

    expect(calls).toEqual(["try-2"]);
  });
});

describe("synchronous transactions", () => {
  test("withTxHooks returns a synchronous callback's value and flushes before it returns", () => {
    const { calls, record } = createRecorder();

    const result = withTxHooks((txHooks) => {
      txHooks.onCommit(record("commit"));
      return 1;
    });

    expect(result).toBe(1);
    expect(calls).toEqual(["commit"]);
  });

  test("withTxHooks discards synchronously when a synchronous callback throws", () => {
    const { calls, record } = createRecorder();

    expect(() =>
      withTxHooks((txHooks) => {
        txHooks.onCommit(record("commit"));
        txHooks.onRollback(record("rollback"));
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");

    expect(calls).toEqual(["rollback"]);
  });

  test("onCommit: throws after running every commit callback when one returns a promise", () => {
    const after = vi.fn();

    expect(() => {
      withTxHooks((txHooks) => {
        // oxlint-disable-next-line typescript/no-misused-promises -- exercising the runtime check for an async commit callback
        txHooks.onCommit(async () => {});
        txHooks.onCommit(after);
      });
    }).toThrow(
      "txHooks of a synchronous transaction require synchronous commit callbacks: a commit callback returned a promise",
    );

    expect(after).toHaveBeenCalledOnce();
  });

  test("withSavepoint returns a synchronous fn's value and rolls back synchronously on a throw", () => {
    const { calls, record } = createRecorder();

    withTxHooks((txHooks) => {
      expect(txHooks.withSavepoint(() => 1)).toBe(1);
      expect(() =>
        txHooks.withSavepoint(() => {
          txHooks.onCommit(record("dropped"));
          txHooks.onRollback(record("rollback"));
          throw new Error("savepoint rolled back");
        }),
      ).toThrow("savepoint rolled back");
      expect(calls).toEqual(["rollback"]);
    });

    expect(calls).toEqual(["rollback"]);
  });

  test("retryBoundary reruns a synchronous fn and throws when called from inside its own try", () => {
    const { calls, record } = createRecorder();

    withTxHooks((txHooks) => {
      const wrapped = txHooks.retryBoundary((tryIndex: number) => {
        txHooks.onCommit(record(`try-${tryIndex}`));
        if (tryIndex === 1) {
          expect(() => wrapped(3)).toThrow(
            "txHooks.retryBoundary: the previous try is still running",
          );
        }
        return tryIndex;
      });
      expect(wrapped(1)).toBe(1);
      expect(wrapped(2)).toBe(2);
    });

    expect(calls).toEqual(["try-2"]);
  });

  test("flush throws when a savepoint's rollback callback returned a promise", () => {
    expect(() => {
      withTxHooks((txHooks) => {
        const savepoint = txHooks.createSavepoint();
        txHooks.onRollback(async () => {});
        savepoint.rollback();
      });
    }).toThrow(
      "txHooks of a synchronous transaction require synchronous rollback callbacks: a rollback callback returned a promise",
    );
  });

  test("createTxHooks: flush returns nothing when every commit callback is synchronous", () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooks();
    txHooks.onCommit(record("commit"));

    expect(flush()).toBeUndefined();
    expect(calls).toEqual(["commit"]);
  });
});
