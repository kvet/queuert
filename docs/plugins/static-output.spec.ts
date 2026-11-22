import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { finishStaticOutput } from "./static-output.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true })),
  );
});

const write = async (root: string, path: string, content: string) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
};

const listFiles = async (root: string) =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();

describe("finishStaticOutput", () => {
  it("turns the 404 page into 404.html and marks the site as non-Jekyll", async () => {
    const root = await mkdtemp(join(tmpdir(), "queuert-docs-"));
    directories.push(root);
    await write(root, "index.html", "home");
    await write(root, "guides/scheduling/index.html", "scheduling");
    await write(root, "404/index.html", "not found");
    await write(root, "assets/app.js", "app");

    await finishStaticOutput(root);

    expect(await listFiles(root)).toEqual([
      ".nojekyll",
      "404.html",
      "assets/app.js",
      "guides/scheduling/index.html",
      "index.html",
    ]);
    expect(await readFile(join(root, "404.html"), "utf8")).toBe("not found");
  });
});
