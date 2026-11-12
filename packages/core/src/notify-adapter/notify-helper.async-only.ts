export const batchNotify = (notify: (values: string[]) => Promise<void>) => {
  let pending: Set<string> | undefined;
  let sending: Promise<void> = Promise.resolve();
  const sendPending = async (): Promise<void> => {
    const batch = pending!;
    pending = undefined;
    try {
      await notify(Array.from(batch));
    } catch {}
  };
  return async (values: string[]): Promise<void> => {
    if (values.length === 0) return;
    if (pending === undefined) {
      pending = new Set(values);
      sending = Promise.resolve().then(sendPending);
    } else {
      for (const value of values) pending.add(value);
    }
    return sending;
  };
};
