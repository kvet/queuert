import { isThenable, silence } from "@queuert/helpers";

const settledMessage =
  "txHooks were already flushed or discarded; open new tx hooks for a new transaction";

const runRollbackCallbacks = (callbacks: (() => unknown)[]): { error: unknown } | undefined => {
  let failure: { error: unknown } | undefined;
  for (let index = callbacks.length - 1; index >= 0; index--) {
    try {
      const result: unknown = callbacks[index]();
      if (isThenable(result)) silence(result);
    } catch (error) {
      failure ??= { error };
    }
  }
  return failure;
};

export class HookRegistry<TCommitCallback extends () => unknown> {
  private commitCallbacks: TCommitCallback[] = [];
  private rollbackCallbacks: (() => void)[] = [];
  private openSnapshots: symbol[] | undefined;
  private settled = false;

  private throwIfSettled(): void {
    if (this.settled) throw new Error(settledMessage);
  }

  onCommit(callback: TCommitCallback): void {
    this.throwIfSettled();
    this.commitCallbacks.push(callback);
  }

  onRollback(callback: () => void): void {
    this.throwIfSettled();
    this.rollbackCallbacks.push(callback);
  }

  snapshot(): () => void {
    this.throwIfSettled();
    const commitMark = this.commitCallbacks.length;
    const rollbackMark = this.rollbackCallbacks.length;
    const snapshotId = Symbol("queuert.txHooks.snapshot");
    const openSnapshots = (this.openSnapshots ??= []);
    openSnapshots.push(snapshotId);
    return () => {
      if (this.settled) return;
      const depth = openSnapshots.indexOf(snapshotId);
      if (depth === -1) return;
      openSnapshots.length = depth + 1;
      this.commitCallbacks.length = commitMark;
      runRollbackCallbacks(this.rollbackCallbacks.splice(rollbackMark));
    };
  }

  takeCommitCallbacks(): TCommitCallback[] {
    this.settled = true;
    const callbacks = this.commitCallbacks;
    this.commitCallbacks = [];
    this.rollbackCallbacks = [];
    return callbacks;
  }

  discard(): void {
    if (this.settled) return;
    this.settled = true;
    const callbacks = this.rollbackCallbacks;
    this.commitCallbacks = [];
    this.rollbackCallbacks = [];
    const failure = runRollbackCallbacks(callbacks);
    // oxlint-disable-next-line typescript/only-throw-error -- re-throwing caught error
    if (failure) throw failure.error;
  }
}
