import { once } from "node:events";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import Docker from "dockerode";
import * as lockfile from "proper-lockfile";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
  getContainerRuntimeClient,
} from "testcontainers";

// Container names are machine-wide, so the lock must be too: a per-checkout lock lets parallel
// worktrees race to create the same container and remove the one another run is using.
const LOCKS_DIR = path.join(os.tmpdir(), "queuert-testcontainers-locks");

const ensureLocksDir = (): void => {
  if (!fs.existsSync(LOCKS_DIR)) {
    fs.mkdirSync(LOCKS_DIR, { recursive: true });
  }
};

const getLockPath = (lockName: string): string => {
  return path.join(LOCKS_DIR, lockName);
};

const ensureLockFile = (lockPath: string): void => {
  if (!fs.existsSync(lockPath)) {
    fs.writeFileSync(lockPath, "");
  }
};

const removeStoppedContainerByName = async (containerName: string): Promise<void> => {
  const docker = new Docker();
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    if (info.State.Running) return;
    await container.remove({ force: true });
  } catch {}
};

export type WithContainerLockOptions<T extends StartedTestContainer> = {
  containerName: string;
  start: () => Promise<T>;
};

const lockedStart = async <T extends StartedTestContainer>({
  containerName,
  start,
}: WithContainerLockOptions<T>): Promise<T> => {
  ensureLocksDir();
  const lockPath = getLockPath(containerName);
  ensureLockFile(lockPath);

  const release = await lockfile.lock(lockPath, {
    stale: 120_000,
    retries: {
      retries: 50,
      minTimeout: 100,
      maxTimeout: 3_000,
    },
  });

  try {
    try {
      return await start();
    } catch {}

    await removeStoppedContainerByName(containerName);
    return await start();
  } finally {
    await release();
  }
};

export const REAPED_LABELS: Record<string, string> = {
  "queuert-testcontainers": "reaped-when-idle",
};

const REAPER_CONTAINER_NAME = "queuert-ryuk-test";
const REAPER_IDLE_TIMEOUT = "15m";

let reaperConnection: Promise<void> | undefined;

const connectToReaper = async (): Promise<void> => {
  const client = await getContainerRuntimeClient();
  const reaper = await lockedStart({
    containerName: REAPER_CONTAINER_NAME,
    start: async () =>
      new GenericContainer("testcontainers/ryuk:0.14.0")
        .withName(REAPER_CONTAINER_NAME)
        .withExposedPorts(8080)
        .withBindMounts([
          { source: client.info.containerRuntime.remoteSocketPath, target: "/var/run/docker.sock" },
        ])
        .withEnvironment({ RYUK_RECONNECTION_TIMEOUT: REAPER_IDLE_TIMEOUT })
        .withWaitStrategy(Wait.forLogMessage(/Started/))
        .withAutoRemove(true)
        .withReuse()
        .start(),
  });

  const socket = net.connect(reaper.getMappedPort(8080), reaper.getHost());
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.write(
    Object.entries(REAPED_LABELS)
      .map(([key, value]) => `label=${key}=${value}\n`)
      .join(""),
  );
  await once(socket, "data");
  socket.unref();
};

export const withContainerLock = async <T extends StartedTestContainer>(
  options: WithContainerLockOptions<T>,
): Promise<T> => {
  reaperConnection ??= connectToReaper().catch((error: unknown) => {
    reaperConnection = undefined;
    throw error;
  });
  await reaperConnection;
  return lockedStart(options);
};
