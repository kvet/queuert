import { runSteps, type StepYield, type Steps, type WaitYield } from "./steps.ts";

type Waits<TYield> = [Extract<TYield, WaitYield>] extends [never] ? false : true;

export type SyncAsync<TArgs extends unknown[], TResult, TWaits extends boolean = false> = {
  readonly sync: (...args: TArgs) => TWaits extends true ? Promise<TResult> : TResult;
  readonly async: (...args: TArgs) => Promise<TResult>;
  readonly steps: (
    ...args: TArgs
  ) => Steps<TResult, TWaits extends true ? StepYield | WaitYield : StepYield>;
};

export const syncAsync = <TArgs extends unknown[], TResult, TYield extends StepYield | WaitYield>(
  steps: (...args: TArgs) => Generator<TYield, TResult, unknown>,
): SyncAsync<TArgs, TResult, Waits<TYield>> => ({
  steps: steps as SyncAsync<TArgs, TResult, Waits<TYield>>["steps"],
  sync(...args) {
    return runSteps(steps.apply(this, args), true) as ReturnType<
      SyncAsync<TArgs, TResult, Waits<TYield>>["sync"]
    >;
  },
  async async(...args) {
    return runSteps(steps.apply(this, args), false);
  },
});
