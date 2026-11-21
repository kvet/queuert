import type { MaybePromise, SyncAsync, ModeResult, Mode } from "@queuert/sync-async";

import type { JobTypes } from "../job-types/job-types.ts";
import { wrapJobTypesWithLogging } from "../job-types/job-types.wrapper.logging.ts";
import { createInProcessNotifyAdapter } from "../notify-adapter.in-process/notify-adapter.in-process.ts";
import type { NotifyAdapter } from "../notify-adapter/notify-adapter.ts";
import { wrapNotifyAdapterWithLogging } from "../notify-adapter/notify-adapter.wrapper.logging.ts";
import { type NotifyHelper, createNotifyHelper } from "../notify-adapter/notify-helper.ts";
import type { TxNotificationsByTransaction } from "../notify-adapter/tx-notifications.ts";
import type { Log } from "../observability-adapter/log.ts";
import { createNoopObservabilityAdapter } from "../observability-adapter/observability-adapter.noop.ts";
import type { ObservabilityAdapter } from "../observability-adapter/observability-adapter.ts";
import { createNoopObservabilityHelper } from "../observability-adapter/observability-helper.noop.ts";
import {
  type ObservabilityHelper,
  createObservabilityHelper,
} from "../observability-adapter/observability-helper.ts";
import type { StateAdapter, BaseTxContext } from "../state-adapter/state-adapter.ts";
import { wrapStateAdapterWithLogging } from "../state-adapter/state-adapter.wrapper.logging.ts";

/**
 * A state adapter of either mode, seen through the operations both modes share.
 *
 * @typeParam TMode - The mode of the state adapter, when the caller knows it
 */
export type Helpers<TMode extends Mode = Mode> = {
  sync: TMode extends "sync" ? true : false;
  stateAdapter: StateAdapter<any, any, any, Mode>;
  notifyHelper: NotifyHelper;
  observabilityHelper: ObservabilityHelper;
  jobTypes: JobTypes;
  txNotifications: TxNotificationsByTransaction;
};

export const runInMode = <TMode extends Mode, TArgs extends unknown[], TResult>(
  helpers: Helpers<TMode>,
  fn: SyncAsync<TArgs, TResult>,
  ...args: TArgs
): ModeResult<TMode, TResult> =>
  (helpers.sync ? fn.sync(...args) : fn.async(...args)) as ModeResult<TMode, TResult>;

export const withHelpersTransaction = <TArgs extends unknown[], TResult>(
  helpers: Helpers,
  fn: SyncAsync<[BaseTxContext, ...TArgs], TResult>,
  ...args: TArgs
): MaybePromise<TResult> =>
  helpers.stateAdapter.withTransaction((txCtx: BaseTxContext) =>
    runInMode(helpers, fn, txCtx, ...args),
  );

export const createHelpers = ({
  stateAdapter: stateAdapterOption,
  notifyAdapter: notifyAdapterOption,
  observabilityAdapter: observabilityAdapterOption,
  jobTypes: jobTypesOption,
  log,
}: {
  stateAdapter: StateAdapter<any, any, any, Mode>;
  notifyAdapter?: NotifyAdapter<Mode>;
  observabilityAdapter?: ObservabilityAdapter;
  jobTypes: JobTypes;
  log?: Log;
}): Helpers => {
  const sync = stateAdapterOption.sync === true;
  if (sync && notifyAdapterOption !== undefined && notifyAdapterOption.sync !== true) {
    throw new Error(
      "A sync state adapter requires a sync notify adapter: pass a notify adapter with `sync: true`",
    );
  }
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
  });
  return {
    sync,
    stateAdapter,
    notifyHelper: createNotifyHelper({
      adapter: wrapNotifyAdapterWithLogging({
        notifyAdapter:
          notifyAdapterOption ?? createInProcessNotifyAdapter({ mode: sync ? "sync" : "async" }),
        observabilityHelper,
      }),
    }),
    observabilityHelper,
    jobTypes: wrapJobTypesWithLogging({
      jobTypes: jobTypesOption,
      observabilityHelper,
    }),
    txNotifications: new WeakMap(),
  };
};
