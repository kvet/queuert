import { describe, expect, it } from "vitest";

import { installCommand, packageManagers, stateInstallOptions } from "./installation.tsx";

const commandFor = (stateLabel: string, notifyLabel: string) => {
  const state = stateInstallOptions.find((option) => option.label === stateLabel)!;
  const notify = state.notify.find((option) => option.label === notifyLabel)!;
  return installCommand("npm install", [...state.packages, ...notify.packages]);
};

describe("installCommand", () => {
  it("installs queuert with the picked packages", () => {
    expect(commandFor("SQLite", "IPC")).toBe("npm install queuert @queuert/sqlite @queuert/ipc");
    expect(commandFor("MySQL / MariaDB", "NATS")).toBe(
      "npm install queuert @queuert/mysql @queuert/nats @nats-io/nats-core @nats-io/transport-node",
    );
  });

  it("names a package once when state and notify share it", () => {
    expect(commandFor("PostgreSQL", "PostgreSQL LISTEN/NOTIFY")).toBe(
      "npm install queuert @queuert/postgres",
    );
    expect(commandFor("Redis", "Redis")).toBe("npm install queuert @queuert/redis");
  });

  it("adds nothing for no notify adapter", () => {
    expect(commandFor("PostgreSQL", "None")).toBe("npm install queuert @queuert/postgres");
  });

  it("uses each package manager's own install verb", () => {
    expect(packageManagers.map((manager) => installCommand(manager.install, []))).toEqual([
      "npm install queuert",
      "pnpm add queuert",
      "yarn add queuert",
    ]);
  });
});

describe("stateInstallOptions", () => {
  it("offers no notify adapter as the last choice for every state adapter", () => {
    for (const state of stateInstallOptions) {
      expect(state.notify.at(-1)?.label).toBe("None");
    }
  });
});
