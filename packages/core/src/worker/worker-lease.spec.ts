import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { holdLease, workerLeaseConfigViolations } from "./worker-lease.ts";

const config = { durationMs: 100, heartbeatMs: 20 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

const pending = Symbol("pending");
const settled = async <T>(promise: Promise<T>) => Promise.race([promise, Promise.resolve(pending)]);

describe("holdLease", () => {
  it("renews every heartbeat while the lease is held", async () => {
    const renew = vi.fn(async () => true);
    const stop = new AbortController();
    const held = holdLease({ config, startedAt: performance.now(), renew, signal: stop.signal });

    await vi.advanceTimersByTimeAsync(config.durationMs * 3);

    expect(renew).toHaveBeenCalledTimes(15);
    await expect(settled(held)).resolves.toBe(pending);
    stop.abort();
    await expect(held).resolves.toBe(true);
  });

  it("loses the lease when a renewal reports it gone", async () => {
    const renew = vi.fn(async () => false);
    const held = holdLease({
      config,
      startedAt: performance.now(),
      renew,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(config.heartbeatMs);

    await expect(held).resolves.toBe(false);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("loses the lease durationMs - heartbeatMs after it started while renewals throw", async () => {
    const held = holdLease({
      config,
      startedAt: performance.now(),
      renew: async () => {
        throw new Error("database unreachable");
      },
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(config.durationMs - config.heartbeatMs - 1);
    await expect(settled(held)).resolves.toBe(pending);

    await vi.advanceTimersByTimeAsync(1);
    await expect(held).resolves.toBe(false);
  });

  it("loses the lease at its deadline while a renewal hangs", async () => {
    const renew = vi.fn(async () => new Promise<boolean>(() => {}));
    const held = holdLease({
      config,
      startedAt: performance.now(),
      renew,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(config.durationMs - config.heartbeatMs - 1);
    await expect(settled(held)).resolves.toBe(pending);

    await vi.advanceTimersByTimeAsync(1);
    await expect(held).resolves.toBe(false);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("keeps the lease through failed renewals followed by a successful one", async () => {
    const results = [false, false, true, false, false, true];
    const stop = new AbortController();
    const held = holdLease({
      config,
      startedAt: performance.now(),
      renew: async () => {
        if (results.shift() === false) throw new Error("database unreachable");
        return true;
      },
      signal: stop.signal,
    });

    await vi.advanceTimersByTimeAsync(config.heartbeatMs * 6);

    await expect(settled(held)).resolves.toBe(pending);
    stop.abort();
    await expect(held).resolves.toBe(true);
  });

  it("moves the deadline from when the last successful renewal was sent", async () => {
    const reply = Promise.withResolvers<boolean>();
    const renew = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(reply.promise)
      .mockRejectedValue(new Error("database unreachable"));
    const held = holdLease({
      config,
      startedAt: performance.now(),
      renew,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(config.heartbeatMs + 10);
    reply.resolve(true);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(config.durationMs - config.heartbeatMs - 11);
    await expect(settled(held)).resolves.toBe(pending);

    await vi.advanceTimersByTimeAsync(1);
    await expect(held).resolves.toBe(false);
  });

  it("does not revive the lease with a renewal that succeeds past the deadline", async () => {
    const reply = Promise.withResolvers<boolean>();
    const renew = vi.fn(async () => reply.promise);
    const held = holdLease({
      config,
      startedAt: performance.now(),
      renew,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(config.durationMs - config.heartbeatMs);
    reply.resolve(true);

    await expect(held).resolves.toBe(false);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("counts the deadline from when the registration was sent", async () => {
    const held = holdLease({
      config,
      startedAt: performance.now() - config.heartbeatMs,
      renew: async () => {
        throw new Error("database unreachable");
      },
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(config.durationMs - 2 * config.heartbeatMs - 1);
    await expect(settled(held)).resolves.toBe(pending);

    await vi.advanceTimersByTimeAsync(1);
    await expect(held).resolves.toBe(false);
  });

  it("renews right away when less than a heartbeat remains after a slow registration", async () => {
    const renew = vi.fn(async () => true);
    const stop = new AbortController();
    const held = holdLease({
      config,
      startedAt:
        performance.now() - (config.durationMs - config.heartbeatMs - config.heartbeatMs / 2),
      renew,
      signal: stop.signal,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(config.heartbeatMs);
    await expect(settled(held)).resolves.toBe(pending);
    stop.abort();
    await expect(held).resolves.toBe(true);
  });

  it("stops waiting for a hung renewal once the signal aborts", async () => {
    const stop = new AbortController();
    const held = holdLease({
      config,
      startedAt: performance.now(),
      renew: async () => new Promise<boolean>(() => {}),
      signal: stop.signal,
    });

    await vi.advanceTimersByTimeAsync(config.heartbeatMs);
    stop.abort();

    await expect(held).resolves.toBe(true);
  });

  it("stops renewing once the signal aborts", async () => {
    const renew = vi.fn(async () => true);
    const stop = new AbortController();
    const held = holdLease({ config, startedAt: performance.now(), renew, signal: stop.signal });
    stop.abort();

    await expect(held).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(config.durationMs * 2);
    expect(renew).not.toHaveBeenCalled();
  });
});

describe("workerLeaseConfigViolations", () => {
  it("accepts a heartbeat below a third of the duration", () => {
    expect(
      workerLeaseConfigViolations("leaseConfig", { durationMs: 60_000, heartbeatMs: 15_000 }),
    ).toEqual([]);
  });

  it("rejects a heartbeat that is not below a third of the duration", () => {
    expect(workerLeaseConfigViolations("leaseConfig", { durationMs: 90, heartbeatMs: 30 })).toEqual(
      ["leaseConfig.heartbeatMs must be below a third of leaseConfig.durationMs (got 30 and 90)"],
    );
  });

  it("rejects non-positive or non-finite values", () => {
    expect(
      workerLeaseConfigViolations("leaseConfig", {
        durationMs: 0,
        heartbeatMs: Number.POSITIVE_INFINITY,
      }),
    ).toEqual([
      "leaseConfig.durationMs must be a positive finite number (got 0)",
      "leaseConfig.heartbeatMs must be a positive finite number (got Infinity)",
    ]);
  });
});
