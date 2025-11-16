export type Notifier = {
  notify: (queueName: string) => Promise<void>;
  listen: (
    queueNames: string[],
    { signal }: { signal?: AbortSignal }
  ) => Promise<void>;
};
