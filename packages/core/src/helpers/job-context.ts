import { AsyncLocalStorage } from "node:async_hooks";

export const jobContextStorage = new AsyncLocalStorage<{
  chainId: string;
  chainTypeName: string;
  rootChainId: string;
  originId: string;
  originTraceContext: unknown;
}>();

export const withJobContext = async <T>(
  context: {
    chainId: string;
    chainTypeName: string;
    rootChainId: string;
    originId: string;
    originTraceContext: unknown;
  },
  cb: () => Promise<T>,
): Promise<T> => {
  return jobContextStorage.run(
    {
      ...context,
    },
    cb,
  );
};
