export const safeInvoke = (fn: () => void): void => {
  try {
    fn();
  } catch {}
};
