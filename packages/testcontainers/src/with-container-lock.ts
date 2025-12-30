import Docker from "dockerode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as lockfile from "proper-lockfile";
import type { StartedTestContainer } from "testcontainers";

const LOCKS_DIR = path.join(import.meta.dirname, "../node_modules/.locks");

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

const removeContainerByName = async (containerName: string): Promise<void> => {
  const docker = new Docker();
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    if (info.State.Running) {
      await container.stop();
    }
    await container.remove({ force: true });
  } catch {}
};

export interface WithContainerLockOptions<T extends StartedTestContainer> {
  containerName: string;
  start: () => Promise<T>;
}

export const withContainerLock = async <T extends StartedTestContainer>({
  containerName,
  start,
}: WithContainerLockOptions<T>): Promise<T> => {
  ensureLocksDir();
  const lockPath = getLockPath(containerName);
  ensureLockFile(lockPath);

  const release = await lockfile.lock(lockPath, {
    retries: {
      minTimeout: 100,
      maxTimeout: 30_000,
    },
  });

  try {
    try {
      return await start();
    } catch {}

    await removeContainerByName(containerName);
    return await start();
  } finally {
    await release();
  }
};
