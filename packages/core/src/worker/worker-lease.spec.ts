import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startWorkerLease, workerLeaseConfigViolations } from "./worker-lease.js";

const config = { durationMs: 100, heartbeatMs: 20 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startWorkerLease", () => {
  it("renews every heartbeat and stays live", async () => {
    const renew = vi.fn(async () => true);
    const onRenewed = vi.fn();
    const onLost = vi.fn();
    const lease = startWorkerLease({
      config,
      sentAt: performance.now(),
      renew,
      onRenewed,
      onLost,
    });

    await vi.advanceTimersByTimeAsync(config.durationMs * 3);

    expect(renew).toHaveBeenCalledTimes(15);
    expect(onRenewed).toHaveBeenCalledTimes(15);
    expect(onLost).not.toHaveBeenCalled();
    expect(lease.isLive()).toBe(true);
    expect(lease.hasRenewed()).toBe(true);
    lease.stop();
  });

  it("loses the lease once when a renewal reports it gone", async () => {
    const renew = vi.fn(async () => false);
    const onLost = vi.fn();
    const lease = startWorkerLease({
      config,
      sentAt: performance.now(),
      renew,
      onRenewed: () => {},
      onLost,
    });

    await vi.advanceTimersByTimeAsync(config.heartbeatMs);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(lease.isLive()).toBe(false);

    await vi.advanceTimersByTimeAsync(config.durationMs * 2);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(lease.hasRenewed()).toBe(false);
  });

  it("loses the lease at sentAt + durationMs - heartbeatMs while renewals throw", async () => {
    const onLost = vi.fn();
    const lease = startWorkerLease({
      config,
      sentAt: performance.now(),
      renew: async () => {
        throw new Error("database unreachable");
      },
      onRenewed: () => {},
      onLost,
    });

    await vi.advanceTimersByTimeAsync(config.durationMs - config.heartbeatMs - 1);
    expect(onLost).not.toHaveBeenCalled();
    expect(lease.isLive()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(lease.isLive()).toBe(false);
  });

  it("loses the lease at its local deadline while a renewal hangs", async () => {
    const onLost = vi.fn();
    const renew = vi.fn(async () => new Promise<boolean>(() => {}));
    startWorkerLease({ config, sentAt: performance.now(), renew, onRenewed: () => {}, onLost });

    await vi.advanceTimersByTimeAsync(config.durationMs - config.heartbeatMs);

    expect(renew).toHaveBeenCalledTimes(1);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("survives two failed renewals in a row", async () => {
    const results = [false, false, true];
    const onLost = vi.fn();
    const lease = startWorkerLease({
      config,
      sentAt: performance.now(),
      renew: async () => {
        if (results.shift() === false) throw new Error("database unreachable");
        return true;
      },
      onRenewed: () => {},
      onLost,
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(onLost).not.toHaveBeenCalled();
    expect(lease.isLive()).toBe(true);
    lease.stop();
  });

  it("moves the deadline from when the last successful renewal was sent", async () => {
    const onLost = vi.fn();
    const replies: PromiseWithResolvers<boolean>[] = [];
    const lease = startWorkerLease({
      config,
      sentAt: performance.now(),
      renew: async () => {
        const reply = Promise.withResolvers<boolean>();
        replies.push(reply);
        return reply.promise;
      },
      onRenewed: () => {},
      onLost,
    });

    await vi.advanceTimersByTimeAsync(config.heartbeatMs);
    await vi.advanceTimersByTimeAsync(30);
    replies[0].resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(config.durationMs - config.heartbeatMs - 31);
    expect(onLost).not.toHaveBeenCalled();
    expect(lease.isLive()).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("reports the lease lost past its deadline before the timer fires", () => {
    const onLost = vi.fn();
    const sentAt = performance.now();
    const lease = startWorkerLease({
      config,
      sentAt: sentAt - config.durationMs,
      renew: async () => true,
      onRenewed: () => {},
      onLost,
    });

    expect(lease.isLive()).toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("ignores a renewal that succeeds after the lease was lost", async () => {
    const onRenewed = vi.fn();
    const onLost = vi.fn();
    const reply = Promise.withResolvers<boolean>();
    const lease = startWorkerLease({
      config,
      sentAt: performance.now(),
      renew: async () => reply.promise,
      onRenewed,
      onLost,
    });

    await vi.advanceTimersByTimeAsync(config.durationMs);
    reply.resolve(true);
    await vi.advanceTimersByTimeAsync(config.durationMs);

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onRenewed).not.toHaveBeenCalled();
    expect(lease.isLive()).toBe(false);
  });

  it("neither renews nor loses the lease once stopped", async () => {
    const renew = vi.fn(async () => true);
    const onLost = vi.fn();
    const lease = startWorkerLease({
      config,
      sentAt: performance.now(),
      renew,
      onRenewed: () => {},
      onLost,
    });
    lease.stop();

    await vi.advanceTimersByTimeAsync(config.durationMs * 2);

    expect(renew).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
  });
});

describe("workerLeaseConfigViolations", () => {
  it("accepts a heartbeat below a third of the duration", () => {
    expect(
      workerLeaseConfigViolations("lease", { durationMs: 60_000, heartbeatMs: 15_000 }),
    ).toEqual([]);
  });

  it("rejects a heartbeat that is not below a third of the duration", () => {
    expect(workerLeaseConfigViolations("lease", { durationMs: 90, heartbeatMs: 30 })).toEqual([
      "lease.heartbeatMs must be below a third of lease.durationMs (got 30 and 90)",
    ]);
  });

  it("rejects non-positive or non-finite values", () => {
    expect(
      workerLeaseConfigViolations("lease", {
        durationMs: 0,
        heartbeatMs: Number.POSITIVE_INFINITY,
      }),
    ).toEqual([
      "lease.durationMs must be a positive finite number (got 0)",
      "lease.heartbeatMs must be a positive finite number (got Infinity)",
    ]);
  });
});
