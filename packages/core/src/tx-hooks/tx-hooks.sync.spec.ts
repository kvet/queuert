import { describe, expect, test, vi } from "vitest";

import { createTxHooksSync, withTxHooksSync } from "./tx-hooks.sync.ts";

const createRecorder = () => {
  const calls: string[] = [];
  return {
    calls,
    record: (label: string) => () => {
      calls.push(label);
    },
  };
};

const rerunSync = <T>(tries: number, cb: (tryIndex: number) => T): T => {
  let lastError: unknown;
  for (let tryIndex = 1; tryIndex <= tries; tryIndex++) {
    try {
      return cb(tryIndex);
    } catch (error) {
      lastError = error;
    }
  }
  // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
  throw lastError;
};

describe("TxHooksSync", () => {
  test("onCommit: runs commit callbacks in registration order after the callback returns", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      txHooks.onCommit(record("first"));
      txHooks.onCommit(record("second"));
      expect(calls).toEqual([]);
    });

    expect(calls).toEqual(["first", "second"]);
  });

  test("onCommit: throws after running every commit callback when one returns a promise", () => {
    const after = vi.fn();

    expect(() => {
      withTxHooksSync((txHooks) => {
        // oxlint-disable-next-line typescript/no-misused-promises -- exercising the runtime check for an async commit callback
        txHooks.onCommit(async () => {});
        txHooks.onCommit(after);
      });
    }).toThrow(
      "TxHooksSync requires synchronous commit callbacks: a commit callback returned a promise",
    );

    expect(after).toHaveBeenCalledOnce();
  });

  test("onCommit: runs every commit callback even if one throws, then rethrows the first error", () => {
    const after = vi.fn();
    const error = new Error("commit callback failed");

    expect(() => {
      withTxHooksSync((txHooks) => {
        txHooks.onCommit(() => {
          throw error;
        });
        txHooks.onCommit(() => {
          throw new Error("second failure");
        });
        txHooks.onCommit(after);
      });
    }).toThrow(error);

    expect(after).toHaveBeenCalledOnce();
  });

  test("onRollback: rollback callbacks do not run on commit", () => {
    const rollback = vi.fn();

    withTxHooksSync((txHooks) => {
      txHooks.onRollback(rollback);
    });

    expect(rollback).not.toHaveBeenCalled();
  });
});

describe("withTxHooksSync", () => {
  test("returns callback result on success", () => {
    const result = withTxHooksSync(() => 42);
    expect(result).toBe(42);
  });

  test("propagates callback error", () => {
    const error = new Error("boom");
    expect(() =>
      withTxHooksSync(() => {
        throw error;
      }),
    ).toThrow(error);
  });

  test("drops commit callbacks and runs rollback callbacks newest first when the callback throws", () => {
    const { calls, record } = createRecorder();

    expect(() =>
      withTxHooksSync((txHooks) => {
        txHooks.onCommit(record("commit"));
        txHooks.onRollback(record("rollback-first"));
        txHooks.onRollback(record("rollback-second"));
        throw new Error("transaction failed");
      }),
    ).toThrow("transaction failed");

    expect(calls).toEqual(["rollback-second", "rollback-first"]);
  });

  test("discard: runs every rollback callback even if one throws, then rethrows the original error", () => {
    const remaining = vi.fn();
    const txError = new Error("transaction failed");

    expect(() =>
      withTxHooksSync((txHooks) => {
        txHooks.onRollback(remaining);
        txHooks.onRollback(() => {
          throw new Error("rollback callback failed");
        });
        throw txError;
      }),
    ).toThrow(txError);

    expect(remaining).toHaveBeenCalledOnce();
  });

  test("throws and discards when the callback returns a promise", () => {
    const { calls, record } = createRecorder();

    expect(() => {
      void withTxHooksSync(async (txHooks) => {
        txHooks.onCommit(record("commit"));
        txHooks.onRollback(record("rollback"));
        return 1;
      });
    }).toThrow("withTxHooksSync requires a synchronous callback");

    expect(calls).toEqual(["rollback"]);
  });
});

describe("createTxHooksSync", () => {
  test("manual lifecycle - flush runs commit callbacks", () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooksSync();
    txHooks.onCommit(record("commit"));
    txHooks.onRollback(record("rollback"));

    flush();

    expect(calls).toEqual(["commit"]);
  });

  test("manual lifecycle - discard runs rollback callbacks", () => {
    const { calls, record } = createRecorder();
    const { txHooks, discard } = createTxHooksSync();
    txHooks.onCommit(record("commit"));
    txHooks.onRollback(record("rollback"));

    discard();

    expect(calls).toEqual(["rollback"]);
  });

  test("manual lifecycle - discard runs every rollback callback, then rethrows the first error", () => {
    const remaining = vi.fn();
    const error = new Error("rollback callback failed");
    const { txHooks, discard } = createTxHooksSync();
    txHooks.onRollback(remaining);
    txHooks.onRollback(() => {
      throw error;
    });

    expect(() => {
      discard();
    }).toThrow(error);
    expect(remaining).toHaveBeenCalledOnce();
  });
});

describe("withSavepoint", () => {
  test("returns fn result on success and keeps its callbacks", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      const result = txHooks.withSavepoint(() => {
        txHooks.onCommit(record("inside"));
        txHooks.onRollback(record("rollback"));
        return 42;
      });
      expect(result).toBe(42);
    });

    expect(calls).toEqual(["inside"]);
  });

  test("drops commit callbacks and runs rollback callbacks registered in fn when fn throws", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      txHooks.onCommit(record("commit-before"));
      txHooks.onRollback(record("rollback-before"));

      expect(() =>
        txHooks.withSavepoint(() => {
          txHooks.onCommit(record("commit-inside"));
          txHooks.onRollback(record("rollback-inside"));
          throw new Error("boom");
        }),
      ).toThrow("boom");

      expect(calls).toEqual(["rollback-inside"]);
    });

    expect(calls).toEqual(["rollback-inside", "commit-before"]);
  });

  test("passes the same txHooks instance to the callback", () => {
    withTxHooksSync((txHooks) => {
      txHooks.withSavepoint((inner) => {
        expect(inner).toBe(txHooks);
      });
    });
  });

  test("nested savepoints: inner rollback does not affect outer callbacks", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      txHooks.onCommit(record("a"));
      txHooks.withSavepoint(() => {
        txHooks.onCommit(record("b"));
        expect(() =>
          txHooks.withSavepoint(() => {
            txHooks.onCommit(record("c"));
            throw new Error("inner");
          }),
        ).toThrow("inner");
      });
    });

    expect(calls).toEqual(["a", "b"]);
  });

  test("nested savepoints: outer rollback also rolls back a released inner savepoint", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      txHooks.onCommit(record("a"));
      expect(() =>
        txHooks.withSavepoint(() => {
          txHooks.onCommit(record("b"));
          txHooks.withSavepoint(() => {
            txHooks.onCommit(record("c"));
            txHooks.onRollback(record("rollback-c"));
          });
          throw new Error("outer");
        }),
      ).toThrow("outer");
    });

    expect(calls).toEqual(["rollback-c", "a"]);
  });

  test("rolls back and throws when fn returns a promise", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      expect(() => {
        void txHooks.withSavepoint(async () => {
          txHooks.onCommit(record("dropped"));
          txHooks.onRollback(record("rollback"));
        });
      }).toThrow("TxHooksSync.withSavepoint requires a synchronous callback");
    });

    expect(calls).toEqual(["rollback"]);
  });
});

describe("createSavepoint", () => {
  test("rollback drops commit callbacks and runs rollback callbacks registered after the savepoint", () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooksSync();

    txHooks.onCommit(record("event-1"));
    const sp = txHooks.createSavepoint();
    txHooks.onCommit(record("event-2-bad"));
    txHooks.onRollback(record("undo-event-2"));
    sp.rollback();
    txHooks.onCommit(record("event-3"));
    flush();

    expect(calls).toEqual(["undo-event-2", "event-1", "event-3"]);
  });

  test("release keeps callbacks, so a later discard runs their rollback callbacks", () => {
    const { calls, record } = createRecorder();
    const { txHooks, discard } = createTxHooksSync();

    const sp = txHooks.createSavepoint();
    txHooks.onRollback(record("promoted"));
    sp.release();
    discard();

    expect(calls).toEqual(["promoted"]);
  });

  test("returns the same txHooks instance", () => {
    const { txHooks } = createTxHooksSync();
    const sp = txHooks.createSavepoint();
    expect(sp.txHooks).toBe(txHooks);
  });

  test("rolling back again rolls back what was registered since the first rollback", () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooksSync();

    txHooks.onCommit(record("a"));
    const sp = txHooks.createSavepoint();
    txHooks.onCommit(record("b"));
    sp.rollback();
    txHooks.onCommit(record("c"));
    sp.rollback();
    flush();

    expect(calls).toEqual(["a"]);
  });

  test("rollback after release still rolls back", () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooksSync();

    const sp = txHooks.createSavepoint();
    txHooks.onCommit(record("b"));
    sp.release();
    sp.rollback();
    flush();

    expect(calls).toEqual([]);
  });

  test("rollback runs every rollback callback even if one throws", () => {
    const remaining = vi.fn();
    const { txHooks } = createTxHooksSync();

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
    const { txHooks, discard } = createTxHooksSync();

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

  test("registering a callback after flush throws", () => {
    const { txHooks, flush } = createTxHooksSync();
    flush();

    expect(() => {
      txHooks.onCommit(() => {});
    }).toThrow(settledError);
    expect(() => {
      txHooks.onRollback(() => {});
    }).toThrow(settledError);
  });

  test("savepoints and retryBoundary tries throw after flush", () => {
    const { txHooks, flush } = createTxHooksSync();
    const runTry = txHooks.retryBoundary(() => {});
    flush();

    expect(() => txHooks.createSavepoint()).toThrow(settledError);
    expect(() => {
      txHooks.withSavepoint(() => {});
    }).toThrow(settledError);
    expect(() => {
      runTry();
    }).toThrow(settledError);
  });

  test("rolling back a savepoint after flush does nothing", () => {
    const rollback = vi.fn();
    const { txHooks, flush } = createTxHooksSync();
    const sp = txHooks.createSavepoint();
    txHooks.onRollback(rollback);
    flush();

    sp.rollback();

    expect(rollback).not.toHaveBeenCalled();
  });

  test("savepoints and retryBoundary tries throw after discard, and an earlier savepoint's rollback does nothing", () => {
    const rollback = vi.fn();
    const { txHooks, discard } = createTxHooksSync();
    const runTry = txHooks.retryBoundary(() => {});
    const sp = txHooks.createSavepoint();
    txHooks.onRollback(rollback);
    discard();

    expect(() => txHooks.createSavepoint()).toThrow(settledError);
    expect(() => {
      txHooks.withSavepoint(() => {});
    }).toThrow(settledError);
    expect(() => {
      runTry();
    }).toThrow(settledError);
    sp.rollback();
    expect(rollback).toHaveBeenCalledOnce();
  });

  test("flushing after discard and discarding after flush do nothing", () => {
    const { calls, record } = createRecorder();
    const flushed = createTxHooksSync();
    flushed.txHooks.onRollback(record("rollback"));
    const discarded = createTxHooksSync();
    discarded.txHooks.onCommit(record("commit"));

    flushed.flush();
    flushed.discard();
    discarded.discard();
    discarded.flush();

    expect(calls).toEqual([]);
  });
});

describe("rollback order", () => {
  test("rolling back an outer savepoint makes a later inner rollback a no-op", () => {
    const { calls, record } = createRecorder();
    const { txHooks, flush } = createTxHooksSync();

    const outer = txHooks.createSavepoint();
    txHooks.onRollback(record("rollback"));
    const inner = txHooks.createSavepoint();
    outer.rollback();
    txHooks.onCommit(record("after-outer-rollback"));
    inner.rollback();
    flush();

    expect(calls).toEqual(["rollback", "after-outer-rollback"]);
  });

  test("a retryBoundary rerun after its enclosing savepoint rolled back does not roll back again", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      const runTry = txHooks.retryBoundary((tryIndex: number) => {
        if (tryIndex === 1) throw new Error("serialization failure");
      });
      try {
        txHooks.withSavepoint(() => {
          txHooks.onRollback(record("rollback"));
          runTry(1);
        });
      } catch {}
      txHooks.onCommit(record("after-savepoint"));
      runTry(2);
    });

    expect(calls).toEqual(["rollback", "after-savepoint"]);
  });
});

describe("retryBoundary", () => {
  test("rolls back the previous try on re-entry and keeps callbacks from before the first try", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      txHooks.onCommit(record("commit:before"));
      rerunSync(
        3,
        txHooks.retryBoundary((tryIndex: number) => {
          txHooks.onCommit(record(`commit:try-${tryIndex}`));
          txHooks.onRollback(record(`rollback:try-${tryIndex}`));
          if (tryIndex < 3) throw new Error("serialization failure");
        }),
      );
    });

    expect(calls).toEqual(["rollback:try-1", "rollback:try-2", "commit:before", "commit:try-3"]);
  });

  test("undoes a try that failed after fn returned", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      const runTry = txHooks.retryBoundary((tryIndex: number) => {
        txHooks.onCommit(record(`try-${tryIndex}`));
      });
      rerunSync(2, (tryIndex) => {
        runTry(tryIndex);
        if (tryIndex === 1) throw new Error("commit failed");
      });
    });

    expect(calls).toEqual(["try-2"]);
  });

  test("forwards the driver's arguments and returns fn's result", () => {
    withTxHooksSync((txHooks) => {
      const wrapped = txHooks.retryBoundary(
        (session: string, tryIndex: number) => `${session}:${tryIndex}`,
      );
      expect(wrapped("session", 1)).toBe("session:1");
    });
  });

  test("throws when called while the previous try is still running", () => {
    withTxHooksSync((txHooks) => {
      const wrapped: () => void = txHooks.retryBoundary(() => {
        expect(() => {
          wrapped();
        }).toThrow("txHooks.retryBoundary: the previous try is still running");
      });
      wrapped();
    });
  });

  test("supports withSavepoint inside a try", () => {
    const { calls, record } = createRecorder();

    withTxHooksSync((txHooks) => {
      rerunSync(
        2,
        txHooks.retryBoundary((tryIndex: number) => {
          txHooks.onCommit(record(`try-${tryIndex}`));
          try {
            txHooks.withSavepoint(() => {
              txHooks.onCommit(record(`savepoint-${tryIndex}`));
              throw new Error("savepoint rolled back");
            });
          } catch {}
          if (tryIndex === 1) throw new Error("serialization failure");
        }),
      );
    });

    expect(calls).toEqual(["try-2"]);
  });
});
