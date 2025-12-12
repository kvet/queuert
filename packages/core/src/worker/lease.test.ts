import { describe, expect, test, vi } from "vitest";
import { createLeaseManager } from "./lease.js";

describe("createLeaseManager", () => {
  test("calls commitLease on start with default leaseMs", async () => {
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const manager = createLeaseManager({
      commitLease,
      config: {},
    });

    await manager.start();
    await manager.stop();

    expect(commitLease).toHaveBeenCalledWith(30_000);
  });

  test("calls commitLease with configured leaseMs", async () => {
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const manager = createLeaseManager({
      commitLease,
      config: { leaseMs: 5000 },
    });

    await manager.start();
    await manager.stop();

    expect(commitLease).toHaveBeenCalledWith(5000);
  });

  test("renews lease at configured interval", async () => {
    vi.useFakeTimers();
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const manager = createLeaseManager({
      commitLease,
      config: { leaseMs: 1000, renewIntervalMs: 500 },
    });

    await manager.start();
    expect(commitLease).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    expect(commitLease).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(500);
    expect(commitLease).toHaveBeenCalledTimes(3);

    await manager.stop();
    vi.useRealTimers();
  });

  test("stop prevents further renewals", async () => {
    vi.useFakeTimers();
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const manager = createLeaseManager({
      commitLease,
      config: { leaseMs: 1000, renewIntervalMs: 500 },
    });

    await manager.start();
    expect(commitLease).toHaveBeenCalledTimes(1);

    await manager.stop();

    await vi.advanceTimersByTimeAsync(1000);
    expect(commitLease).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  test("errors propagate from commitLease", async () => {
    const error = new Error("connection lost");
    const commitLease = vi.fn().mockRejectedValue(error);

    const manager = createLeaseManager({
      commitLease,
      config: {},
    });

    await expect(manager.start()).rejects.toThrow("connection lost");
    await manager.stop();
  });

  test("stop can be called before start completes", async () => {
    let resolveCommit: () => void;
    const commitLeasePromise = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    const commitLease = vi.fn().mockReturnValue(commitLeasePromise);

    const manager = createLeaseManager({
      commitLease,
      config: {},
    });

    const startPromise = manager.start();
    await manager.stop();

    resolveCommit!();
    await startPromise;

    expect(commitLease).toHaveBeenCalledTimes(1);
  });

  test("uses default renewIntervalMs of 15 seconds", async () => {
    vi.useFakeTimers();
    const commitLease = vi.fn().mockResolvedValue(undefined);

    const manager = createLeaseManager({
      commitLease,
      config: {},
    });

    await manager.start();
    expect(commitLease).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(commitLease).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(commitLease).toHaveBeenCalledTimes(2);

    await manager.stop();
    vi.useRealTimers();
  });
});
