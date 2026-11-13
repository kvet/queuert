import { type MaybePromise, requireSync } from "@queuert/helpers/maybe-promise";

import { type AdapterMode, isSyncAdapter } from "../adapter-mode.ts";
import type { JobTypes } from "../job-types/job-types.ts";
import { wrapJobTypesWithLogging } from "../job-types/job-types.wrapper.logging.ts";
import {
  createInProcessNotifyAdapter,
  createSyncInProcessNotifyAdapter,
} from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import type { AnyNotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import { wrapNotifyAdapterWithLogging } from "../notify-adapter/notify-adapter.wrapper.logging.ts";
import { type NotifyHelper, createNotifyHelper } from "../notify-adapter/notify-helper.ts";
import type { Log } from "../observability-adapter/log.ts";
import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.ts";
import type { ObservabilityAdapter } from "../observability-adapter/observability-adapter.ts";
import { createNoopObservabilityHelper } from "../observability-adapter/observability-helper.noop.ts";
import {
  type ObservabilityHelper,
  createObservabilityHelper,
} from "../observability-adapter/observability-helper.ts";
import type {
  AnyStateAdapter,
  BaseTxContext,
  StateAdapterOperations,
} from "../state-adapter/state-adapter.ts";
import { wrapStateAdapterWithLogging } from "../state-adapter/state-adapter.wrapper.logging.ts";

/** A state adapter of either mode, seen through the operations both modes share. */
export type ModeStateAdapter = StateAdapterOperations<any, any, any, AdapterMode>;

export type Helpers = {
  sync: boolean;
  stateAdapter: ModeStateAdapter;
  notifyHelper: NotifyHelper;
  observabilityHelper: ObservabilityHelper;
  jobTypes: JobTypes;
};

const syncResultMessage =
  "A synchronous state adapter returned a promise: every method of an adapter with `sync: true` must return its result directly";

/**
 * Runs `fn` as a client call: in the sync mode it returns `fn`'s value and throws its errors, in
 * the async mode it returns a promise, so an error thrown synchronously still rejects.
 */
export const runInMode = <T>(helpers: Helpers, fn: () => MaybePromise<T>): MaybePromise<T> => {
  if (helpers.sync) return requireSync(fn(), syncResultMessage);
  try {
    return Promise.resolve(fn());
  } catch (error) {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- re-rejecting a caught error
    return Promise.reject(error);
  }
};

/** In the sync mode, throws when a caller's callback returned a promise. */
export const requireCallbackResult = <T>(
  helpers: Helpers,
  value: MaybePromise<T>,
): MaybePromise<T> =>
  helpers.sync
    ? requireSync(value, "Expected a synchronous callback, but it returned a promise")
    : value;

/** Opens a transaction on the client's state adapter and runs `fn` in it. */
export const withHelpersTransaction = <T>(
  helpers: Helpers,
  fn: (txCtx: BaseTxContext) => MaybePromise<T>,
): MaybePromise<T> =>
  helpers.stateAdapter.withTransaction((txCtx: BaseTxContext) =>
    runInMode(helpers, () => fn(txCtx)),
  );

export const createHelpers = ({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  jobTypes: jobTypesOption,
  log,
}: {
  stateAdapter: AnyStateAdapter;
  notifyAdapter?: AnyNotifyAdapter;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypes: JobTypes;
  log?: Log;
}): Helpers => {
  const sync = isSyncAdapter(stateAdapterOption);
  const observabilityHelper =
    log === undefined && observabilityAdapterOption === undefined
      ? createNoopObservabilityHelper()
      : createObservabilityHelper({
          log,
          adapter: observabilityAdapterOption ?? createNoopObservabilityAdapter(),
        });
  const stateAdapter = wrapStateAdapterWithLogging({
    stateAdapter: stateAdapterOption,
    observabilityHelper,
  }) as ModeStateAdapter;
  return {
    sync,
    stateAdapter,
    notifyHelper: createNotifyHelper({
      adapter: wrapNotifyAdapterWithLogging({
        notifyAdapter:
          notifyAdapterOption ??
          (sync ? createSyncInProcessNotifyAdapter() : createInProcessNotifyAdapter()),
        observabilityHelper,
      }),
    }),
    observabilityHelper,
    jobTypes: wrapJobTypesWithLogging({
      jobTypes: jobTypesOption,
      observabilityHelper,
    }),
  };
};
