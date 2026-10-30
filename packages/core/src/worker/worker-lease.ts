import { isPositiveFinite, setLongTimeout, sleep } from "@queuert/helpers";

/** Lease of each worker an in-process worker starts. */
export type WorkerLeaseConfig = {
  /**
   * How long a worker's lease lasts without a renewal. Must be finite and positive.
   *
   * @defaultValue 60_000
   */
  durationMs: number;
  /**
   * How often the lease is renewed. Must be finite, positive and below a third of `durationMs`.
   *
   * @defaultValue 15_000
   */
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

const localDeadline = (sentAt: number, config: WorkerLeaseConfig): number =>
  sentAt + config.durationMs - config.heartbeatMs;

export const startWorkerLease = ({
  config,
  sentAt,
  renew,
  onRenewed,
  onLost,
}: {
  config: WorkerLeaseConfig;
  sentAt: number;
  renew: () => Promise<boolean>;
  onRenewed: () => void;
  onLost: () => void;
}): { isLive: () => boolean; hasRenewed: () => boolean; stop: () => void } => {
  const loopController = new AbortController();
  const state = {
    deadline: localDeadline(sentAt, config),
    lost: false,
    renewed: false,
    clearDeadline: () => {},
  };

  const lose = () => {
    if (state.lost || loopController.signal.aborted) return;
    state.lost = true;
    loopController.abort();
    state.clearDeadline();
    onLost();
  };
  const armDeadline = (deadline: number) => {
    state.clearDeadline();
    state.deadline = deadline;
    state.clearDeadline = setLongTimeout(lose, deadline - performance.now());
  };
  const isLive = () => {
    if (!state.lost && !loopController.signal.aborted && performance.now() >= state.deadline) {
      lose();
    }
    return !state.lost;
  };

  const renewOnce = async (): Promise<void> => {
    const renewalSentAt = performance.now();
    const renewed = await renew().then(
      (result) => result,
      () => undefined,
    );
    if (loopController.signal.aborted || renewed === undefined) return;
    if (!renewed) {
      lose();
      return;
    }
    if (!isLive()) return;
    armDeadline(localDeadline(renewalSentAt, config));
    state.renewed = true;
    onRenewed();
  };

  const runLoop = async () => {
    while (!loopController.signal.aborted) {
      await sleep(config.heartbeatMs, { signal: loopController.signal });
      if (loopController.signal.aborted) return;
      await renewOnce();
    }
  };

  armDeadline(state.deadline);
  void runLoop();

  return {
    isLive,
    hasRenewed: () => state.renewed,
    stop: () => {
      loopController.abort();
      state.clearDeadline();
    },
  };
};
