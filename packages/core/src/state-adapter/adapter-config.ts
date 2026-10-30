import { randomUUID } from "node:crypto";

import { isPositiveSafeInteger } from "@queuert/helpers";

import { type StateAdapterConfig } from "./state-adapter.js";

const assertPositiveInteger = (value: number, name: string): void => {
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`Invalid ${name}: expected a positive integer, got ${String(value)}`);
  }
};

/** Applies the defaults to a state adapter factory's options and rejects invalid limits. */
export const resolveStateAdapterConfig = <TJobId extends string>({
  generateId,
  validateId = () => true,
  generateWorkerId = () => randomUUID(),
  validateWorkerId = () => true,
  maxBlockersPerJob = 100,
  countCap = 10_000,
}: {
  generateId: () => TJobId;
  validateId?: ((id: TJobId) => boolean) | undefined;
  generateWorkerId?: (() => string) | undefined;
  validateWorkerId?: ((id: string) => boolean) | undefined;
  maxBlockersPerJob?: number | undefined;
  countCap?: number | undefined;
}): Readonly<StateAdapterConfig<TJobId>> => {
  assertPositiveInteger(maxBlockersPerJob, "maxBlockersPerJob");
  assertPositiveInteger(countCap, "countCap");
  return Object.freeze({
    generateId,
    validateId,
    generateWorkerId,
    validateWorkerId,
    maxBlockersPerJob,
    countCap,
  });
};
