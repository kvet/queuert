import {
  type NatsConnectionOptions,
  NatsContainer,
  type StartedNatsContainer,
} from "@testcontainers/nats";

import { withContainerLock } from "./with-container-lock.ts";

export type { NatsConnectionOptions };

export type AcquiredNats = {
  connectionOptions: NatsConnectionOptions;
} & AsyncDisposable;

const containerNameFromImage = (image: string): string =>
  `queuert-nats-${image.replace(/[^a-z0-9]/gi, "-")}-test`;

const containerPromises = new Map<string, Promise<StartedNatsContainer>>();

const startContainer = async (image: string): Promise<StartedNatsContainer> => {
  let promise = containerPromises.get(image);
  if (!promise) {
    const containerName = containerNameFromImage(image);
    promise = withContainerLock({
      containerName,
      start: async () =>
        new NatsContainer(image)
          .withName(containerName)
          .withLabels({ label: containerName })
          .withReuse()
          .start(),
    });
    containerPromises.set(image, promise);
  }
  return promise;
};

export const acquireNats = async (image: string): Promise<AcquiredNats> => {
  const container = await startContainer(image);

  return {
    connectionOptions: container.getConnectionOptions(),
    [Symbol.asyncDispose]: async () => {},
  };
};
