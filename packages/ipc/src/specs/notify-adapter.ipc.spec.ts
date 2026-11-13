import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { link, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { type Socket, createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { sleep } from "@queuert/helpers/sleep";
import type { SyncNotifyAdapter } from "queuert";
import { it as baseIt, describe, expect } from "vitest";

import { createIpcNotifyAdapter } from "../notify-adapter/notify-adapter.ipc.ts";

const it = baseIt
  // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
  .extend("directory", async ({}, { onCleanup }) => {
    const directory = await mkdtemp(join(tmpdir(), "queuert-ipc-"));
    onCleanup(async () => rm(directory, { recursive: true, force: true }));
    return directory;
  })
  .extend("createAdapter", ({ directory }, { onCleanup }) => {
    const adapters: SyncNotifyAdapter[] = [];
    onCleanup(() => {
      for (const adapter of adapters) adapter.close();
    });
    return (
      adapterDirectory: string = directory,
      onError?: (error: unknown) => void,
    ): SyncNotifyAdapter => {
      const adapter = createIpcNotifyAdapter({ directory: adapterDirectory, onError });
      adapters.push(adapter);
      return adapter;
    };
  })
  .extend(
    "readRegistry",
    ({ directory }) =>
      async (
        registryDirectory: string = directory,
      ): Promise<{ fileName: string; pid: number; address: string }[]> => {
        const fileNames = await readdir(registryDirectory).catch(() => [] as string[]);
        return Promise.all(
          fileNames
            .filter((fileName) => fileName.endsWith(".json"))
            .map(async (fileName) => ({
              fileName,
              ...(JSON.parse(await readFile(join(registryDirectory, fileName), "utf8")) as {
                pid: number;
                address: string;
              }),
            })),
        );
      },
  )
  .extend(
    "waitForRegistry",
    ({ readRegistry }) =>
      async (count: number, registryDirectory?: string) => {
        await expect.poll(async () => readRegistry(registryDirectory)).toHaveLength(count);
        return readRegistry(registryDirectory);
      },
  )
  .extend(
    "notifyUntil",
    () =>
      async (notify: () => void, received: () => boolean): Promise<void> => {
        await expect
          .poll(
            () => {
              notify();
              return received();
            },
            { timeout: 5000, interval: 100 },
          )
          .toBe(true);
      },
  )
  .extend("spawnListener", ({ directory }, { onCleanup }) => {
    const children: ChildProcess[] = [];
    onCleanup(() => {
      for (const child of children) child.kill("SIGKILL");
    });
    return (): {
      child: ChildProcess;
      lines: string[];
      waitFor: (line: string) => Promise<void>;
    } => {
      const child = spawn(
        process.execPath,
        [join(import.meta.dirname, "notify-adapter.ipc.process.ts"), directory],
        { cwd: join(import.meta.dirname, "..", ".."), stdio: ["pipe", "pipe", "inherit"] },
      );
      children.push(child);
      const lines: string[] = [];
      const waiters: { line: string; resolve: () => void }[] = [];
      createInterface({ input: child.stdout }).on("line", (line) => {
        lines.push(line);
        for (const waiter of waiters.filter((candidate) => candidate.line === line)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve();
        }
      });
      return {
        child,
        lines,
        waitFor: async (line) => {
          if (lines.includes(line)) return;
          await new Promise<void>((resolve) => waiters.push({ line, resolve }));
        },
      };
    };
  })
  .extend("exitedPid", async () => {
    const exited = spawn(process.execPath, ["-e", ""]);
    await once(exited, "exit");
    return exited.pid!;
  });

describe("configuration", () => {
  it("rejects an empty directory", () => {
    expect(() => createIpcNotifyAdapter({ directory: "" })).toThrow(
      "createIpcNotifyAdapter: `directory` must be a non-empty string",
    );
  });
});

describe("between adapter instances", () => {
  it("delivers a sender's first notification to every process already registered", async ({
    createAdapter,
    waitForRegistry,
  }) => {
    const listener = createAdapter();
    const received: string[] = [];
    listener.listenJobScheduled(["type-a"], (typeName) => {
      received.push(typeName);
    });
    await waitForRegistry(1);

    createAdapter().notifyJobsScheduled(["type-a"]);

    await expect.poll(() => received, { timeout: 2000 }).toEqual(["type-a"]);
  });

  it("does not deliver between adapters with different directories", async ({
    createAdapter,
    directory,
    notifyUntil,
  }) => {
    const sender = createAdapter(join(directory, "group-a"));
    const otherGroup = createAdapter(join(directory, "group-b"));
    const sameGroup = createAdapter(join(directory, "group-a"));
    let otherGroupReceived = false;
    let sameGroupReceived = false;
    otherGroup.listenJobScheduled(["type-a"], () => {
      otherGroupReceived = true;
    });
    sameGroup.listenJobScheduled(["type-a"], () => {
      sameGroupReceived = true;
    });

    await notifyUntil(
      () => {
        sender.notifyJobsScheduled(["type-a"]);
      },
      () => sameGroupReceived,
    );
    await sleep(200);
    expect(otherGroupReceived).toBe(false);
  });

  it("ignores malformed lines on the socket", async ({ createAdapter, waitForRegistry }) => {
    const receiver = createAdapter();
    const received: string[] = [];
    receiver.listenJobScheduled(["type-a"], (typeName) => received.push(typeName));
    const [{ address }] = await waitForRegistry(1);

    const socket = createConnection(address);
    socket.write('not json\n{"kind":"unknown","key":"type-a"}\n{"kind":"jobScheduled"}\n');
    socket.write(`${JSON.stringify({ kind: "jobScheduled", key: "type-a" })}\n`);
    socket.end();

    await expect.poll(() => received, { timeout: 2000 }).toEqual(["type-a"]);
  });
});

describe("connections", () => {
  it.skipIf(process.platform === "win32")(
    "reuses one connection per recipient and reconnects after it drops",
    async ({ createAdapter, directory, notifyUntil }) => {
      const address = join(directory, "recipient.sock");
      const accepted: Socket[] = [];
      const lines: string[] = [];
      const server = createServer((socket) => {
        accepted.push(socket);
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
          lines.push(...chunk.split("\n").filter((line) => line.length > 0));
        });
      });
      await new Promise<void>((resolve) => server.listen(address, resolve));
      await writeFile(
        join(directory, "recipient.json"),
        JSON.stringify({ pid: process.pid, address }),
      );
      const sender = createAdapter();
      try {
        await notifyUntil(
          () => {
            sender.notifyJobsScheduled(["type-a"]);
          },
          () => lines.length > 0,
        );
        await sleep(200);
        const sentBefore = lines.length;
        sender.notifyJobsScheduled(["type-a"]);
        sender.notifyJobsScheduled(["type-a"]);
        await expect.poll(() => lines.length).toBe(sentBefore + 2);
        expect(accepted).toHaveLength(1);

        accepted[0].destroy();
        await expect
          .poll(
            () => {
              sender.notifyJobsScheduled(["type-a"]);
              return accepted.length;
            },
            { timeout: 5000, interval: 100 },
          )
          .toBe(2);
        await expect.poll(() => lines.length).toBeGreaterThan(sentBefore + 2);
        expect(existsSync(join(directory, "recipient.json"))).toBe(true);
      } finally {
        for (const socket of accepted) socket.destroy();
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        );
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "drops notifications for a recipient that stops reading once 64 KiB are unsent",
    async ({ createAdapter, directory, notifyUntil }) => {
      const address = join(directory, "recipient.sock");
      const accepted: Socket[] = [];
      const lines: string[] = [];
      const server = createServer((socket) => {
        accepted.push(socket);
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
          lines.push(...chunk.split("\n").filter((line) => line.length > 0));
        });
      });
      await new Promise<void>((resolve) => server.listen(address, resolve));
      await writeFile(
        join(directory, "recipient.json"),
        JSON.stringify({ pid: process.pid, address }),
      );
      const sender = createAdapter();
      try {
        await notifyUntil(
          () => {
            sender.notifyJobsScheduled(["type-a"]);
          },
          () => lines.length > 0,
        );
        await sleep(200);
        accepted[0].pause();
        const sentBefore = lines.length;

        for (let i = 0; i < 100_000; i++) sender.notifyJobsScheduled(["type-a"]);
        await sleep(200);
        accepted[0].resume();
        await sleep(500);

        expect(lines.length - sentBefore).toBeGreaterThan(0);
        expect(lines.length - sentBefore).toBeLessThan(5_000);

        sender.notifyJobsScheduled(["type-b"]);
        await expect.poll(() => lines.at(-1)).toContain("type-b");
      } finally {
        for (const socket of accepted) socket.destroy();
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        );
      }
    },
  );
});

describe("registry", () => {
  it("does no I/O until the first listen and writes the registry file then", async ({
    createAdapter,
    directory,
    readRegistry,
    waitForRegistry,
  }) => {
    const groupDirectory = join(directory, "group");
    const adapter = createAdapter(groupDirectory);
    expect(existsSync(groupDirectory)).toBe(false);

    adapter.listenJobScheduled(["type-a"], () => {});

    const [entry] = await waitForRegistry(1, groupDirectory);
    expect(entry.pid).toBe(process.pid);
    if (process.platform !== "win32") expect(existsSync(entry.address)).toBe(true);

    adapter.close();

    expect(await readRegistry(groupDirectory)).toEqual([]);
    if (process.platform !== "win32") {
      await expect.poll(() => existsSync(entry.address)).toBe(false);
    }
  });

  it("does not register a process that only sends", async ({ createAdapter, readRegistry }) => {
    const sender = createAdapter();

    sender.notifyJobsScheduled(["type-a"]);
    await sleep(100);

    expect(await readRegistry()).toEqual([]);
  });

  it("does not register when closed before the server starts", async ({
    createAdapter,
    readRegistry,
  }) => {
    const adapter = createAdapter();

    adapter.listenJobScheduled(["type-a"], () => {});
    adapter.close();
    await sleep(100);

    expect(await readRegistry()).toEqual([]);
  });

  it("reports a failed start to onError and starts on the next listen", async ({
    createAdapter,
    directory,
    waitForRegistry,
  }) => {
    const registryDirectory = join(directory, "group");
    await writeFile(registryDirectory, "not a directory");
    const errors: unknown[] = [];
    const adapter = createAdapter(registryDirectory, (error) => errors.push(error));

    adapter.listenJobScheduled(["type-a"], () => {});
    await expect.poll(() => errors).toEqual([expect.any(Error)]);
    await rm(registryDirectory);
    adapter.listenJobScheduled(["type-a"], () => {});

    const [entry] = await waitForRegistry(1, registryDirectory);
    expect(entry.pid).toBe(process.pid);
    expect(errors).toHaveLength(1);
  });

  it("removes the registry file of a recipient whose process is gone", async ({
    createAdapter,
    directory,
    exitedPid,
  }) => {
    const stalePath = join(directory, "stale.json");
    await writeFile(
      stalePath,
      JSON.stringify({ pid: exitedPid, address: join(directory, "missing.sock") }),
    );
    const sender = createAdapter();

    await expect
      .poll(
        () => {
          sender.notifyJobsScheduled(["type-a"]);
          return existsSync(stalePath);
        },
        { timeout: 5000, interval: 100 },
      )
      .toBe(false);
  });

  it("removes only the socket file named after the stale recipient", async ({
    createAdapter,
    directory,
    exitedPid,
  }) => {
    const unrelatedFile = join(directory, "unrelated.sock");
    await writeFile(unrelatedFile, "keep");
    const stalePath = join(directory, "stale.json");
    await writeFile(stalePath, JSON.stringify({ pid: exitedPid, address: unrelatedFile }));
    const sender = createAdapter();

    await expect
      .poll(
        () => {
          sender.notifyJobsScheduled(["type-a"]);
          return existsSync(stalePath);
        },
        { timeout: 5000, interval: 100 },
      )
      .toBe(false);
    expect(existsSync(unrelatedFile)).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "keeps the registry file of a recipient that refuses connections while its process is alive",
    async ({ createAdapter, directory }) => {
      const orphanSocket = join(directory, "orphan.sock");
      const server = createServer();
      await new Promise<void>((resolve) => server.listen(join(directory, "live.sock"), resolve));
      await link(join(directory, "live.sock"), orphanSocket);
      await new Promise((resolve) => server.close(resolve));
      const refusingPath = join(directory, "refusing.json");
      await writeFile(refusingPath, JSON.stringify({ pid: process.pid, address: orphanSocket }));
      const sender = createAdapter();

      for (let index = 0; index < 5; index++) {
        sender.notifyJobsScheduled(["type-a"]);
        await sleep(300);
      }

      expect(existsSync(refusingPath)).toBe(true);
    },
  );

  it("removes the registry file of a recipient whose socket is gone, even if its pid is alive", async ({
    createAdapter,
    directory,
  }) => {
    const unreachablePath = join(directory, "unreachable.json");
    await writeFile(
      unreachablePath,
      JSON.stringify({ pid: process.pid, address: join(directory, "missing.sock") }),
    );
    const sender = createAdapter();

    await expect
      .poll(
        () => {
          sender.notifyJobsScheduled(["type-a"]);
          return existsSync(unreachablePath);
        },
        { timeout: 5000, interval: 100 },
      )
      .toBe(false);
  });

  it("skips registry files it cannot parse", async ({ createAdapter, directory, notifyUntil }) => {
    await writeFile(join(directory, "broken.json"), "{");
    const sender = createAdapter();
    const receiver = createAdapter();
    let received = false;
    receiver.listenJobScheduled(["type-a"], () => {
      received = true;
    });

    await notifyUntil(
      () => {
        sender.notifyJobsScheduled(["type-a"]);
      },
      () => received,
    );
  });
});

describe("between processes", () => {
  it("delivers to a listener in another process", async ({
    createAdapter,
    readRegistry,
    notifyUntil,
    spawnListener,
  }) => {
    const listener = spawnListener();
    await listener.waitFor("ready");
    const sender = createAdapter();

    await notifyUntil(
      () => {
        sender.notifyJobsScheduled(["type-b", "type-a"]);
      },
      () => listener.lines.includes("received type-a"),
    );
    expect(listener.lines).not.toContain("received type-b");

    listener.child.stdin!.write("close\n");
    await listener.waitFor("closed");
    expect(await readRegistry()).toEqual([]);
  });

  it("lets a listening process exit without close while a sender stays connected", async ({
    createAdapter,
    notifyUntil,
    spawnListener,
  }) => {
    const listener = spawnListener();
    await listener.waitFor("ready");
    const sender = createAdapter();
    await notifyUntil(
      () => {
        sender.notifyJobsScheduled(["type-a"]);
      },
      () => listener.lines.includes("received type-a"),
    );

    const exited = once(listener.child, "exit");
    listener.child.stdin!.write("release\n");
    await listener.waitFor("released");

    await expect(
      Promise.race([exited.then(() => "exited"), sleep(3000).then(() => "still running")]),
    ).resolves.toBe("exited");
  });

  it("removes the registry file of a listener process that was killed", async ({
    createAdapter,
    readRegistry,
    spawnListener,
  }) => {
    const listener = spawnListener();
    await listener.waitFor("ready");
    const [{ address }] = await readRegistry();

    listener.child.kill("SIGKILL");
    await once(listener.child, "exit");
    const sender = createAdapter();

    await expect
      .poll(
        async () => {
          sender.notifyJobsScheduled(["type-a"]);
          return readRegistry();
        },
        { timeout: 5000, interval: 100 },
      )
      .toEqual([]);
    if (process.platform !== "win32") expect(existsSync(address)).toBe(false);
  });
});
