import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bundleDashboardDemoWorker, writeDashboardDemoWorker } from "./dashboard-demo-worker.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true })),
  );
});

const workerSources = async () => {
  const directory = await mkdtemp(join(tmpdir(), "queuert-docs-"));
  directories.push(directory);
  await writeFile(join(directory, "assets.ts"), `export const assets = "dashboard assets";`);
  await writeFile(
    join(directory, "worker.ts"),
    `export const loadAssets = async () => (await import("./assets.ts")).assets;\nconsole.log(loadAssets);`,
  );
  return directory;
};

describe("bundleDashboardDemoWorker", () => {
  it("inlines dynamic imports into one classic script, since service workers cannot import()", async () => {
    const directory = await workerSources();

    const code = await bundleDashboardDemoWorker(join(directory, "worker.ts"), { minify: false });

    expect(code).toContain("dashboard assets");
    expect(code).not.toMatch(/\bimport\s*\(/);
    expect(code).not.toMatch(/^\s*(?:import|export)\s/m);
  });
});

describe("writeDashboardDemoWorker", () => {
  it("writes the bundle to dashboard-demo.js in the static output", async () => {
    const directory = await workerSources();

    await writeDashboardDemoWorker(directory, join(directory, "worker.ts"));

    expect(await readFile(join(directory, "dashboard-demo.js"), "utf8")).toContain(
      "dashboard assets",
    );
  });
});
