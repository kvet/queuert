export type NotifyAdapter = {
  notifyJobScheduled: (typeName: string) => Promise<void>;
  listenJobScheduled: (typeNames: string[], { signal }: { signal?: AbortSignal }) => Promise<void>;
};
