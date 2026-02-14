import { describe, expect, test, vi } from "vitest";
import { createLeaseManager } from "./lease-manager.js";

describe("createLeaseManager", () => {
  test("calls commitLease with leaseMs after renewIntervalMs", async () => {
    vi.useFakeTimers();
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const dispose = createLeaseManager({
      commitLease,
      config: { leaseMs: 60_000, renewIntervalMs: 30_000 },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(commitLease).toHaveBeenCalledTimes(1);
    expect(commitLease).toHaveBeenCalledWith(60_000);

    await dispose();
    vi.useRealTimers();
  });

  test("renews multiple times before disposal", async () => {
    vi.useFakeTimers();
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const dispose = createLeaseManager({
      commitLease,
      config: { leaseMs: 60_000, renewIntervalMs: 10_000 },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(commitLease).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(commitLease).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(commitLease).toHaveBeenCalledTimes(3);

    await dispose();
    vi.useRealTimers();
  });

  test("does not call commitLease before renewIntervalMs elapses", async () => {
    vi.useFakeTimers();
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const dispose = createLeaseManager({
      commitLease,
      config: { leaseMs: 60_000, renewIntervalMs: 30_000 },
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(commitLease).not.toHaveBeenCalled();

    await dispose();
    vi.useRealTimers();
  });

  test("stops renewing after disposal", async () => {
    vi.useFakeTimers();
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const dispose = createLeaseManager({
      commitLease,
      config: { leaseMs: 60_000, renewIntervalMs: 10_000 },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(commitLease).toHaveBeenCalledTimes(1);

    await dispose();

    await vi.advanceTimersByTimeAsync(50_000);
    expect(commitLease).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test("dispose drains an in-flight commitLease call", async () => {
    vi.useFakeTimers();
    let resolveCommit: () => void;
    const commitLease = vi.fn().mockImplementation(
      async () =>
        new Promise<void>((r) => {
          resolveCommit = r;
        }),
    );

    const dispose = createLeaseManager({
      commitLease,
      config: { leaseMs: 60_000, renewIntervalMs: 10_000 },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(commitLease).toHaveBeenCalledTimes(1);

    const disposePromise = dispose();

    // dispose should not resolve yet — commitLease is still in flight
    let disposed = false;
    void disposePromise.then(() => {
      disposed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(disposed).toBe(false);

    resolveCommit!();
    await disposePromise;

    vi.useRealTimers();
  });

  test("stops the loop when commitLease rejects", async () => {
    vi.useFakeTimers();
    const commitLease = vi.fn().mockRejectedValue(new Error("lease failed"));

    const dispose = createLeaseManager({
      commitLease,
      config: { leaseMs: 60_000, renewIntervalMs: 10_000 },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(commitLease).toHaveBeenCalledTimes(1);

    // loop should have stopped — no more calls
    await vi.advanceTimersByTimeAsync(30_000);
    expect(commitLease).toHaveBeenCalledTimes(1);

    await dispose();
    vi.useRealTimers();
  });

  test("dispose can be called immediately", async () => {
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const dispose = createLeaseManager({
      commitLease,
      config: { leaseMs: 60_000, renewIntervalMs: 30_000 },
    });

    await dispose();
    expect(commitLease).not.toHaveBeenCalled();
  });
});
