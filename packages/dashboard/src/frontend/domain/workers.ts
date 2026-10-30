export const isLeaseLost = (worker: { leaseUntil: Date }, now: Date): boolean =>
  worker.leaseUntil.getTime() <= now.getTime();

export const summarizeWorkers = (
  workers: { runningJobCount: number; concurrency: number; leaseUntil: Date }[],
  now: Date,
): { count: number; runningSlots: number; idleSlots: number; leaseLostCount: number } => {
  const runningSlots = workers.reduce((sum, worker) => sum + worker.runningJobCount, 0);
  const concurrency = workers.reduce((sum, worker) => sum + worker.concurrency, 0);
  return {
    count: workers.length,
    runningSlots,
    idleSlots: Math.max(concurrency - runningSlots, 0),
    leaseLostCount: workers.filter((worker) => isLeaseLost(worker, now)).length,
  };
};

export const decodeWorkerId = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};
