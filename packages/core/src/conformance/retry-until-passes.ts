import { sleep } from "@queuert/helpers/sleep";

export const retryUntilPasses = async (
  check: () => void | Promise<void>,
  { timeoutMs = 1000, intervalMs = 50 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
    await sleep(intervalMs);
  }
};
