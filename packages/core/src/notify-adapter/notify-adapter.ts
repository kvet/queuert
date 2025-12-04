export type NotifyAdapter = {
  notifyJobScheduled: (queueName: string) => Promise<void>;
  listenJobScheduled: (queueNames: string[], { signal }: { signal?: AbortSignal }) => Promise<void>;
};
