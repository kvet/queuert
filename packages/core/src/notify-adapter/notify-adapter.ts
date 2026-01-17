export type NotifyAdapter = {
  notifyJobScheduled: (typeName: string, count: number) => Promise<void>;
  listenJobScheduled: (
    typeNames: string[],
    onNotification: (typeName: string) => void,
  ) => Promise<() => Promise<void>>;
  notifyJobChainCompleted: (chainId: string) => Promise<void>;
  listenJobChainCompleted: (
    chainId: string,
    onNotification: () => void,
  ) => Promise<() => Promise<void>>;
  notifyJobOwnershipLost: (jobId: string) => Promise<void>;
  listenJobOwnershipLost: (
    jobId: string,
    onNotification: () => void,
  ) => Promise<() => Promise<void>>;
};
