import { readdirSync } from "node:fs";

import { sleep } from "@queuert/helpers/sleep";

import { createIpcNotifyAdapter } from "../notify-adapter/notify-adapter.ipc.ts";

if (process.argv[1] === import.meta.filename) {
  const directory = process.argv[2];
  const notifyAdapter = createIpcNotifyAdapter({ directory });
  notifyAdapter.listenJobScheduled(["type-a"], (typeName) => {
    process.stdout.write(`received ${typeName}\n`);
  });
  const isRegistered = (): boolean => {
    try {
      return readdirSync(directory).some((fileName) => fileName.endsWith(".json"));
    } catch {
      return false;
    }
  };
  while (!isRegistered()) await sleep(10);
  process.stdout.write("ready\n");
  process.stdin.on("data", (data) => {
    if (data.toString().trim() === "release") {
      process.stdin.destroy();
      process.stdout.write("released\n");
      return;
    }
    notifyAdapter.close();
    process.stdout.write("closed\n");
    process.exit(0);
  });
}
