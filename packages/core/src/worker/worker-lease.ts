import { isPositiveFinite, raceWithSleep, sleep } from "@queuert/helpers";

/** The lease the in-process worker registers its worker with. */
export type WorkerLeaseConfig = {
  /** How long a worker's lease lasts without a renewal. Must be finite and positive. */
  durationMs: number;
  /** How often the lease is renewed. Must be finite, positive and below a third of `durationMs`. */
  heartbeatMs: number;
};

export const workerLeaseConfigViolations = (name: string, config: WorkerLeaseConfig): string[] => [
  ...(isPositiveFinite(config.durationMs)
    ? []
    : [`${name}.durationMs must be a positive finite number (got ${String(config.durationMs)})`]),
  ...(isPositiveFinite(config.heartbeatMs)
    ? []
    : [`${name}.heartbeatMs must be a positive finite number (got ${String(config.heartbeatMs)})`]),
  ...(isPositiveFinite(config.durationMs) &&
  isPositiveFinite(config.heartbeatMs) &&
  3 * config.heartbeatMs >= config.durationMs
    ? [
        `${name}.heartbeatMs must be below a third of ${name}.durationMs (got ${String(config.heartbeatMs)} and ${String(config.durationMs)})`,
      ]
    : []),
];

export const holdLease = async ({
  config,
  startedAt,
  renew,
  signal,
}: {
  config: WorkerLeaseConfig;
  startedAt: number;
  renew: () => Promise<boolean>;
  signal: AbortSignal;
}): Promise<boolean> => {
  const window = config.durationMs - config.heartbeatMs;
  let deadline = startedAt + window;
  let renewalSent = false;
  while (performance.now() < deadline) {
    const remainingMs = deadline - performance.now();
    await sleep(
      renewalSent || remainingMs > config.heartbeatMs
        ? Math.min(config.heartbeatMs, remainingMs)
        : 0,
      {
        signal,
      },
    );
    if (signal.aborted) return true;
    if (performance.now() >= deadline) return false;
    const sentAt = performance.now();
    renewalSent = true;
    const renewed = await raceWithSleep(
      renew().catch(() => undefined),
      deadline - sentAt,
      {
        signal,
      },
    );
    if (renewed === false) return false;
    if (renewed === true) deadline = sentAt + window;
  }
  return false;
};
