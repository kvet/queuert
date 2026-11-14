import { step, syncAsync } from "@queuert/sync-async";

const callReporting = syncAsync(function* (
  fn: (...args: never[]) => unknown,
  args: never[],
  onError: (error: unknown) => void,
) {
  try {
    return yield* step(fn(...args));
  } catch (error) {
    onError(error);
    // oxlint-disable-next-line typescript/only-throw-error -- passes the caught value on unchanged
    throw error;
  }
});

export const reportErrors = <T extends (...args: never[]) => unknown>(
  fn: T,
  onError: (error: unknown) => void,
  { sync }: { sync: boolean },
): T => {
  const call = sync ? callReporting.sync : callReporting.async;
  return ((...args: never[]) => call(fn, args, onError)) as T;
};
