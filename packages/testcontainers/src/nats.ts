import {
  type NatsConnectionOptions,
  NatsContainer,
  type StartedNatsContainer,
} from "@testcontainers/nats";
import { type TestAPI } from "vitest";
import { withContainerLock } from "./with-container-lock.js";

const CONTAINER_NAME = "queuert-nats-test";

export type { NatsConnectionOptions };

let containerPromise: Promise<StartedNatsContainer> | null = null;

const getContainer = async (): Promise<StartedNatsContainer> => {
  containerPromise ??= withContainerLock({
    containerName: CONTAINER_NAME,
    start: async () =>
      new NatsContainer("nats:2.10")
        .withName(CONTAINER_NAME)
        .withLabels({
          label: CONTAINER_NAME,
        })
        .withArg("-js")
        .withReuse()
        .start(),
  });
  return containerPromise;
};

export const extendWithNats = <T>(
  api: TestAPI<T>,
  _reuseId: string,
): TestAPI<
  T & {
    natsConnectionOptions: NatsConnectionOptions;
  }
> => {
  return api.extend<{
    natsConnectionOptions: NatsConnectionOptions;
  }>({
    natsConnectionOptions: [
      // eslint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const container = await getContainer();
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
