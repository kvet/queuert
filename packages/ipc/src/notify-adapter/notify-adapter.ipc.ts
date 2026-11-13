import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import { type Server, type Socket, createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

import { createLatch } from "@queuert/helpers/latch";
import { safeInvoke } from "@queuert/helpers/safe-invoke";
import type { SyncNotifyAdapter } from "queuert";

type Recipient = { id: string; pid: number; address: string };

const recipientRefreshIntervalMs = 1000;
const maxBufferedBytesPerRecipient = 64 * 1024;

const socketName = (id: string): string => `queuert-${id}.sock`;

const parseRecipient = (id: string, content: string): Recipient | undefined => {
  try {
    const { pid, address } = JSON.parse(content) as { pid?: unknown; address?: unknown };
    if (typeof pid === "number" && typeof address === "string") return { id, pid, address };
  } catch {}
  return undefined;
};

/**
 * Create a notify adapter that delivers notifications between processes on one host,
 * such as a web process and a worker process sharing one SQLite database.
 *
 * Each process that listens runs a server on a Unix socket (a named pipe on Windows) and writes a
 * registry file into `directory`. Senders read the registry files and write every notification to
 * every other registered process, which filters it locally. Listeners in the same adapter receive
 * notifications directly, during the `notify*` call.
 *
 * It is a {@link SyncNotifyAdapter}: no method returns a promise. The factory touches nothing. The
 * first `listen*` call starts the server in the background and writes the registry file once it
 * listens; until then, other processes cannot reach this one. If the server cannot listen or the
 * file cannot be written, `onError` receives the error and the next `listen*` call tries again.
 * The first `notify*` call reads the registry files synchronously, so it reaches every process
 * registered by then, and rereads them every second in the background. Socket errors are never
 * thrown: the adapter drops the connection and reconnects on the next send. Notifications are
 * hints: one sent while a process starts or restarts, or before the sender has reread the registry
 * after it registered, is lost, and the next poll catches it. So is one sent while 64 KiB of earlier
 * notifications to the same process are still unsent, which keeps a slow reader from growing the
 * sender's memory.
 *
 * @param options - IPC notify adapter configuration.
 * @throws Error if `directory` is not a non-empty string.
 * @experimental
 */
export const createIpcNotifyAdapter = ({
  directory,
  onError,
}: {
  /**
   * Directory for the registry files. Every process that passes the same directory receives every
   * other one's notifications. Created on first use if it does not exist. The sockets themselves
   * live in the operating system's temporary directory (`os.tmpdir()`), so the processes must
   * also share that: not with systemd's `PrivateTmp`, and in containers that share only this
   * directory, mount a shared temporary directory as well. On Windows they use named pipes instead.
   */
  directory: string;
  /**
   * Called when the server started by a `listen*` call cannot listen or its registry file cannot
   * be written. Runs synchronously; a throw is ignored.
   */
  onError?: (error: unknown) => void;
}): SyncNotifyAdapter => {
  if (typeof directory !== "string" || directory.length === 0) {
    throw new Error("createIpcNotifyAdapter: `directory` must be a non-empty string");
  }

  const id = randomBytes(8).toString("hex");
  const address =
    process.platform === "win32" ? `\\\\.\\pipe\\queuert-${id}` : join(tmpdir(), socketName(id));
  const registryFile = join(directory, `${id}.json`);
  const closed = createLatch("NotifyAdapter is closed");

  const listeners = new Map<string, Set<() => void>>();

  const deliver = (kind: string, key: string): void => {
    for (const listener of Array.from(listeners.get(`${kind}:${key}`) ?? [])) {
      try {
        listener();
      } catch {}
    }
  };

  let server: Server | undefined;
  let serverReady: Promise<void> | undefined;
  const acceptedSockets = new Set<Socket>();

  const stopServer = (): void => {
    for (const socket of acceptedSockets) socket.destroy();
    server?.close();
    server = undefined;
    serverReady = undefined;
    try {
      rmSync(registryFile, { force: true });
    } catch {}
  };

  const listen = async (): Promise<void> => {
    const startingServer = createServer((socket) => {
      socket.unref();
      acceptedSockets.add(socket);
      socket.on("close", () => acceptedSockets.delete(socket));
      socket.on("error", () => {});
      createInterface({ input: socket }).on("line", (line) => {
        try {
          const { kind, key } = JSON.parse(line) as { kind?: unknown; key?: unknown };
          if (typeof kind === "string" && typeof key === "string") deliver(kind, key);
        } catch {}
      });
    });
    server = startingServer;
    startingServer.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        startingServer.once("error", reject);
        startingServer.once("close", resolve);
        startingServer.listen(address, resolve);
      });
      startingServer.on("error", () => {});
      if (server !== startingServer || closed.tripped) return;
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${registryFile}.tmp`, JSON.stringify({ pid: process.pid, address }));
      renameSync(`${registryFile}.tmp`, registryFile);
    } catch (error) {
      if (server === startingServer) stopServer();
      throw error;
    }
  };

  const startServer = (): void => {
    serverReady ??= listen().catch((error: unknown) => {
      safeInvoke(() => onError?.(error));
    });
  };

  let recipients: Recipient[] = [];
  let refreshTimer: NodeJS.Timeout | undefined;
  const connections = new Map<string, Socket>();

  const isRecipientFile = (fileName: string): boolean =>
    fileName.endsWith(".json") && fileName !== `${id}.json`;

  const setRecipients = (found: (Recipient | undefined)[]): void => {
    recipients = found.filter((recipient) => recipient !== undefined);
    const recipientIds = new Set(recipients.map((recipient) => recipient.id));
    for (const [recipientId, connection] of connections) {
      if (!recipientIds.has(recipientId)) connection.destroy();
    }
  };

  const refreshRecipients = async (): Promise<void> => {
    const fileNames = await readdir(directory).catch(() => [] as string[]);
    setRecipients(
      await Promise.all(
        fileNames
          .filter(isRecipientFile)
          .map(async (fileName) =>
            parseRecipient(
              fileName.slice(0, -".json".length),
              await readFile(join(directory, fileName), "utf8").catch(() => ""),
            ),
          ),
      ),
    );
  };

  const readRecipients = (): void => {
    let fileNames: string[] = [];
    try {
      fileNames = readdirSync(directory);
    } catch {}
    setRecipients(
      fileNames.filter(isRecipientFile).map((fileName) => {
        let content = "";
        try {
          content = readFileSync(join(directory, fileName), "utf8");
        } catch {}
        return parseRecipient(fileName.slice(0, -".json".length), content);
      }),
    );
  };

  const removeIfGone = async (recipient: Recipient, connectError: unknown): Promise<void> => {
    const code = (connectError as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTSOCK") {
      try {
        process.kill(recipient.pid, 0);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      }
    }
    recipients = recipients.filter((candidate) => candidate.id !== recipient.id);
    await rm(join(directory, `${recipient.id}.json`), { force: true });
    if (process.platform !== "win32" && basename(recipient.address) === socketName(recipient.id)) {
      await rm(recipient.address, { force: true });
    }
  };

  const connect = (recipient: Recipient): Socket => {
    const existing = connections.get(recipient.id);
    if (existing && !existing.destroyed) return existing;
    const connection = createConnection(recipient.address);
    connection.unref();
    connection.on("error", (error) => {
      void removeIfGone(recipient, error).catch(() => {});
    });
    connection.on("close", () => {
      if (connections.get(recipient.id) === connection) connections.delete(recipient.id);
    });
    connections.set(recipient.id, connection);
    return connection;
  };

  const publish = (kind: string, keys: string[]): void => {
    closed.throwIfTripped();
    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        void refreshRecipients();
      }, recipientRefreshIntervalMs).unref();
      readRecipients();
    }
    for (const key of keys) deliver(kind, key);
    const payload = keys.map((key) => `${JSON.stringify({ kind, key })}\n`).join("");
    for (const recipient of recipients) {
      const connection = connect(recipient);
      if (connection.writableLength < maxBufferedBytesPerRecipient) connection.write(payload);
    }
  };

  const subscribe = (
    kind: string,
    keys: string[],
    onNotification: (key: string) => void,
  ): (() => void) => {
    closed.throwIfTripped();
    const entries = keys.map((key) => {
      const channel = `${kind}:${key}`;
      const listener = (): void => {
        onNotification(key);
      };
      const channelListeners = listeners.get(channel) ?? new Set();
      listeners.set(channel, channelListeners.add(listener));
      return { channel, listener };
    });
    startServer();
    return () => {
      for (const { channel, listener } of entries) {
        listeners.get(channel)?.delete(listener);
        if (listeners.get(channel)?.size === 0) listeners.delete(channel);
      }
    };
  };

  const close = (): void => {
    if (!closed.trip()) return;
    clearInterval(refreshTimer);
    for (const connection of connections.values()) connection.destroy();
    recipients = [];
    listeners.clear();
    stopServer();
  };

  return {
    sync: true,
    notifyJobsScheduled: (typeNames) => {
      publish("jobScheduled", typeNames);
    },
    listenJobScheduled: (typeNames, onNotification) =>
      subscribe("jobScheduled", typeNames, onNotification),
    notifyChainsCompleted: (chainIds) => {
      publish("chainCompleted", chainIds);
    },
    listenChainCompleted: (chainId, onNotification) =>
      subscribe("chainCompleted", [chainId], onNotification),
    notifyJobAttemptsLost: (jobIds) => {
      publish("jobAttemptLost", jobIds);
    },
    listenJobAttemptLost: (jobId, onNotification) =>
      subscribe("jobAttemptLost", [jobId], onNotification),
    close,
    [Symbol.dispose]: close,
  };
};
