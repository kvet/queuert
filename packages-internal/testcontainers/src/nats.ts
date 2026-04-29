import {
  type NatsConnectionOptions,
  NatsContainer,
  type StartedNatsContainer,
} from "@testcontainers/nats";
import { type TestAPI, beforeAll } from "vitest";

import { withContainerLock } from "./with-container-lock.js";

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
          .withArg("-js")
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

export const extendWithNats = <T>(
  api: TestAPI<T>,
  _reuseId: string,
): TestAPI<
  T & {
    natsConnectionOptions: NatsConnectionOptions;
  }
> => {
  let container: StartedNatsContainer;

  beforeAll(async () => {
    container = await startContainer("nats:2.10");
  }, 60_000);

  return api.extend<{
    natsConnectionOptions: NatsConnectionOptions;
  }>({
    natsConnectionOptions: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use(container.getConnectionOptions());
      },
      { scope: "worker" },
    ],
  }) as unknown as TestAPI<
    T & {
      natsConnectionOptions: NatsConnectionOptions;
    }
  >;
};
