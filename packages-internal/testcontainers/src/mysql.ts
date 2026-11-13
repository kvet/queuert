import { createHash } from "node:crypto";

import { createConnection } from "mysql2/promise";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

import { withContainerLock } from "./with-container-lock.ts";

export type MysqlConnectionOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export type AcquiredMysql = { connectionOptions: MysqlConnectionOptions } & AsyncDisposable;

const ROOT_PASSWORD = "queuert";

const containerNameFromImage = (image: string): string =>
  `queuert-mysql-${image.replace(/[^a-z0-9]/gi, "-")}-test`;

const containerPromises = new Map<string, Promise<StartedTestContainer>>();

const startContainer = async (image: string): Promise<StartedTestContainer> => {
  let promise = containerPromises.get(image);
  if (!promise) {
    const containerName = containerNameFromImage(image);
    promise = withContainerLock({
      containerName,
      start: async () =>
        new GenericContainer(image)
          .withName(containerName)
          .withLabels({ label: containerName })
          .withEnvironment({
            MYSQL_ROOT_PASSWORD: ROOT_PASSWORD,
            MARIADB_ROOT_PASSWORD: ROOT_PASSWORD,
          })
          .withExposedPorts(3306)
          .withTmpFs({ "/var/lib/mysql": "rw" })
          .withWaitStrategy(Wait.forLogMessage(/port: 3306/))
          .withStartupTimeout(180_000)
          .withReuse()
          .start(),
    });
    containerPromises.set(image, promise);
  }
  return promise;
};

/** Starts (or reuses) a MySQL or MariaDB container and creates a fresh database for `callerId`. */
export const acquireMysql = async (image: string, callerId: string): Promise<AcquiredMysql> => {
  const database = `t_${createHash("sha1").update(callerId).digest("hex")}`;
  const container = await startContainer(image);
  const host = container.getHost();
  const port = container.getMappedPort(3306);

  const admin = await createConnection({ host, port, user: "root", password: ROOT_PASSWORD });
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(`CREATE DATABASE \`${database}\``);
  } finally {
    await admin.end();
  }

  return {
    connectionOptions: { host, port, user: "root", password: ROOT_PASSWORD, database },
    [Symbol.asyncDispose]: async () => {},
  };
};
