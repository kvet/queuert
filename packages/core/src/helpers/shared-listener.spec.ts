import { describe, expect, test, vi } from "vitest";

import { createSharedListener, type SharedListenerOpen } from "./shared-listener.js";

const createFakeTransport = () => {
  const dispatchers: ((key: string, payload: string) => void)[] = [];
  let openCount = 0;
  let closeCount = 0;

  const open: SharedListenerOpen = async (dispatch) => {
    openCount++;
    dispatchers.push(dispatch);
    return async () => {
      closeCount++;
      const index = dispatchers.indexOf(dispatch);
      if (index !== -1) dispatchers.splice(index, 1);
    };
  };

  const emit = (key: string, payload: string): void => {
    for (const dispatch of dispatchers) dispatch(key, payload);
  };

  return {
    open,
    emit,
    get openCount() {
      return openCount;
    },
    get closeCount() {
      return closeCount;
    },
    get activeCount() {
      return dispatchers.length;
    },
  };
};

describe("createSharedListener", () => {
  test("opens lazily on first subscribe", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    expect(transport.openCount).toBe(0);

    await listener.subscribe("k", () => {});
    expect(transport.openCount).toBe(1);
  });

  test("multiplexes many callbacks for the same key onto a single subscription", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    const a = vi.fn();
    const b = vi.fn();
    await listener.subscribe("k", a);
    await listener.subscribe("k", b);

    expect(transport.openCount).toBe(1);

    transport.emit("k", "hello");
    expect(a).toHaveBeenCalledWith("hello");
    expect(b).toHaveBeenCalledWith("hello");
  });

  test("only callbacks for matching key are invoked", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    const onA = vi.fn();
    const onB = vi.fn();
    await listener.subscribe("a", onA);
    await listener.subscribe("b", onB);

    transport.emit("a", "for-a");

    expect(onA).toHaveBeenCalledWith("for-a");
    expect(onB).not.toHaveBeenCalled();
  });

  test("dispatch for unknown key is a no-op", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    const cb = vi.fn();
    await listener.subscribe("a", cb);

    transport.emit("z", "nobody-cares");
    expect(cb).not.toHaveBeenCalled();
  });

  test("closes underlying subscription when last callback unsubscribes", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    const unsubA = await listener.subscribe("a", () => {});
    const unsubB = await listener.subscribe("b", () => {});

    await unsubA();
    expect(transport.closeCount).toBe(0);

    await unsubB();
    expect(transport.closeCount).toBe(1);
    expect(transport.activeCount).toBe(0);
  });

  test("re-opens after going idle", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    const unsub = await listener.subscribe("k", () => {});
    await unsub();
    expect(transport.closeCount).toBe(1);

    await listener.subscribe("k", () => {});
    expect(transport.openCount).toBe(2);
  });

  test("only one open call when many subscribes race during starting", async () => {
    let resolveOpen!: () => void;
    const openPromise = new Promise<void>((r) => {
      resolveOpen = r;
    });
    let openCount = 0;
    let closeCount = 0;

    const open: SharedListenerOpen = async () => {
      openCount++;
      await openPromise;
      return async () => {
        closeCount++;
      };
    };

    const listener = createSharedListener(open);

    const p1 = listener.subscribe("a", () => {});
    const p2 = listener.subscribe("b", () => {});
    const p3 = listener.subscribe("c", () => {});

    resolveOpen();
    await Promise.all([p1, p2, p3]);

    expect(openCount).toBe(1);
    expect(closeCount).toBe(0);
  });

  test("subscribe during in-flight tearDown waits for it and reopens", async () => {
    const closeGate = Promise.withResolvers<void>();
    let openCount = 0;
    let closeCount = 0;

    const open: SharedListenerOpen = async () => {
      openCount++;
      return async () => {
        closeCount++;
        await closeGate.promise;
      };
    };

    const listener = createSharedListener(open);

    const unsub = await listener.subscribe("k", () => {});
    const unsubPromise = unsub();
    const subscribeDuringStop = listener.subscribe("k", () => {});

    closeGate.resolve();
    await unsubPromise;
    await subscribeDuringStop;

    expect(openCount).toBe(2);
    expect(closeCount).toBe(1);
  });

  test("dispatch after unsubscribe does not invoke removed callback", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    const a = vi.fn();
    const b = vi.fn();
    const unsubA = await listener.subscribe("k", a);
    await listener.subscribe("k", b);

    await unsubA();
    transport.emit("k", "payload");

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith("payload");
  });

  test("dispose tears down running subscription and removes callbacks", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    const cb = vi.fn();
    await listener.subscribe("k", cb);

    await listener.dispose();
    expect(transport.closeCount).toBe(1);

    transport.emit("k", "after-dispose");
    expect(cb).not.toHaveBeenCalled();
  });

  test("subscribe followed by dispose: subscription is torn down, unsub is a safe no-op", async () => {
    let resolveOpen!: () => void;
    const openPromise = new Promise<void>((r) => {
      resolveOpen = r;
    });
    let openCount = 0;
    let closeCount = 0;
    const dispatchers: ((key: string, payload: string) => void)[] = [];

    const open: SharedListenerOpen = async (dispatch) => {
      openCount++;
      await openPromise;
      dispatchers.push(dispatch);
      return async () => {
        closeCount++;
        const i = dispatchers.indexOf(dispatch);
        if (i !== -1) dispatchers.splice(i, 1);
      };
    };

    const listener = createSharedListener(open);

    const cb = vi.fn();
    const subscribePromise = listener.subscribe("k", cb);
    const disposePromise = listener.dispose();

    resolveOpen();
    const unsub = await subscribePromise;
    await disposePromise;

    expect(openCount).toBe(1);
    expect(closeCount).toBe(1);
    expect(dispatchers.length).toBe(0);

    await unsub();
  });

  test("dispose on idle is a no-op", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    await listener.dispose();

    expect(transport.openCount).toBe(0);
    expect(transport.closeCount).toBe(0);
  });

  test("open() rejection resets state to idle so the next subscribe can retry", async () => {
    let attempts = 0;
    const dispatchers: ((key: string, payload: string) => void)[] = [];

    const open: SharedListenerOpen = async (dispatch) => {
      attempts++;
      if (attempts === 1) throw new Error("transport down");
      dispatchers.push(dispatch);
      return async () => {};
    };

    const listener = createSharedListener(open);

    await expect(listener.subscribe("k", () => {})).rejects.toThrow("transport down");

    const cb = vi.fn();
    await listener.subscribe("k", cb);
    expect(attempts).toBe(2);

    for (const d of dispatchers) d("k", "hello");
    expect(cb).toHaveBeenCalledWith("hello");
  });

  test("open() rejection fails only the in-flight subscriber; concurrent subscribers transparently retry", async () => {
    let attempts = 0;
    let rejectFirst!: (err: Error) => void;
    const firstOpen = new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });

    const open: SharedListenerOpen = async () => {
      attempts++;
      if (attempts === 1) await firstOpen;
      return async () => {};
    };

    const listener = createSharedListener(open);

    const p1 = listener.subscribe("a", () => {});
    const p2 = listener.subscribe("b", () => {});

    rejectFirst(new Error("boom"));

    await expect(p1).rejects.toThrow("boom");
    const unsub = await p2;
    expect(attempts).toBe(2);
    await unsub();
  });

  test("dispose during starting that fails to open does not hang", async () => {
    let rejectOpen!: (err: Error) => void;
    const openPromise = new Promise<void>((_, reject) => {
      rejectOpen = reject;
    });

    const open: SharedListenerOpen = async () => {
      await openPromise;
      return async () => {};
    };

    const listener = createSharedListener(open);

    const subscribePromise = listener.subscribe("k", () => {});
    const disposePromise = listener.dispose();

    rejectOpen(new Error("transport down"));

    await expect(subscribePromise).rejects.toThrow("transport down");
    await expect(disposePromise).resolves.toBeUndefined();
  });

  test("dispatch isolates throws — a bad callback does not break peers", async () => {
    const transport = createFakeTransport();
    const listener = createSharedListener(transport.open);

    const a = vi.fn(() => {
      throw new Error("a is bad");
    });
    const b = vi.fn();

    await listener.subscribe("k", a);
    await listener.subscribe("k", b);

    expect(() => {
      transport.emit("k", "payload");
    }).not.toThrow();

    expect(a).toHaveBeenCalledWith("payload");
    expect(b).toHaveBeenCalledWith("payload");
  });

  test("unsubscribe rejection resets state to idle so the listener can be reused", async () => {
    let unsubAttempts = 0;
    const dispatchers: ((key: string, payload: string) => void)[] = [];

    const open: SharedListenerOpen = async (dispatch) => {
      dispatchers.push(dispatch);
      return async () => {
        unsubAttempts++;
        const i = dispatchers.indexOf(dispatch);
        if (i !== -1) dispatchers.splice(i, 1);
        if (unsubAttempts === 1) throw new Error("teardown failed");
      };
    };

    const listener = createSharedListener(open);

    const unsub1 = await listener.subscribe("k", () => {});
    await expect(unsub1()).rejects.toThrow("teardown failed");

    const cb = vi.fn();
    const unsub2 = await listener.subscribe("k", cb);
    for (const d of dispatchers) d("k", "ok");
    expect(cb).toHaveBeenCalledWith("ok");
    await unsub2();
  });
});
