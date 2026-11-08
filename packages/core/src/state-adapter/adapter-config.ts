import { isPositiveSafeInteger } from "@queuert/helpers";

import { InvalidJobIdError, InvalidWorkerIdError } from "../errors.ts";
import type { StateAdapterConfig } from "./state-adapter.ts";

const assertPositiveInteger = (value: number, name: string): void => {
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`Invalid ${name}: expected a positive integer, got ${String(value)}`);
  }
};

/** Applies the defaults to a state adapter factory's options and rejects invalid limits. */
export const resolveStateAdapterConfig = <TJobId extends string, TWorkerId extends string>({
  generateJobId = () => crypto.randomUUID() as TJobId,
  validateJobId = () => true,
  generateWorkerId = () => crypto.randomUUID() as TWorkerId,
  validateWorkerId = () => true,
  maxBlockersPerJob = 100,
  countCap = 10_000,
}: {
  generateJobId?: (() => TJobId) | undefined;
  validateJobId?: ((id: TJobId) => boolean) | undefined;
  generateWorkerId?: (() => TWorkerId) | undefined;
  validateWorkerId?: ((id: TWorkerId) => boolean) | undefined;
  maxBlockersPerJob?: number | undefined;
  countCap?: number | undefined;
}): Readonly<StateAdapterConfig<TJobId, TWorkerId>> => {
  assertPositiveInteger(maxBlockersPerJob, "maxBlockersPerJob");
  assertPositiveInteger(countCap, "countCap");
  return Object.freeze({
    generateJobId,
    validateJobId,
    generateWorkerId,
    validateWorkerId,
    maxBlockersPerJob,
    countCap,
  });
};

export const resolveJobId = (
  config: StateAdapterConfig<any, any>,
  id: string | undefined,
): string => {
  const source = id === undefined ? "generator" : "caller";
  const resolvedId = id ?? config.generateJobId();
  if (!config.validateJobId(resolvedId)) {
    throw new InvalidJobIdError(
      `Invalid job ID "${resolvedId}" from ${source} — failed validateJobId predicate`,
      { id: resolvedId, source },
    );
  }
  return resolvedId;
};

export const resolveWorkerId = (
  config: StateAdapterConfig<any, any>,
  id: string | undefined,
): string => {
  const source = id === undefined ? "generator" : "caller";
  const workerId = id ?? config.generateWorkerId();
  if (!config.validateWorkerId(workerId)) {
    throw new InvalidWorkerIdError(
      `Invalid worker ID "${workerId}" from ${source} — failed validateWorkerId predicate`,
      { id: workerId },
    );
  }
  return workerId;
};
