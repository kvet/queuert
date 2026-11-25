import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

/** The declaration files a tutorial lesson is type-checked against, by their virtual path. */
export type TutorialTypes = Record<string, string>;

const tutorialLibs = ["esnext", "webworker", "webworker.iterable", "webworker.asynciterable"];

const typescriptLibDirectory = dirname(createRequire(import.meta.url).resolve("typescript"));
const queuertDistDirectory = fileURLToPath(new URL("../../packages/core/dist", import.meta.url));

const readLibs = (files: TutorialTypes, directory: string) => {
  const pending = [...tutorialLibs];
  while (pending.length > 0) {
    const name = `lib.${pending.pop()!.toLowerCase()}.d.ts`;
    if (`/lib/${name}` in files) continue;
    const source = readFileSync(join(directory, name), "utf8");
    files[`/lib/${name}`] = source;
    for (const match of source.matchAll(/^\/\/\/ <reference lib="([^"]+)" \/>/gm)) {
      pending.push(match[1]);
    }
  }
};

const readDeclarations = (files: TutorialTypes, directory: string) => {
  if (!existsSync(join(directory, "index.d.mts"))) {
    throw new Error(
      `${directory}/index.d.mts is missing: build queuert first (pnpm --filter queuert build)`,
    );
  }
  const pending = ["index.d.mts"];
  while (pending.length > 0) {
    const file = pending.pop()!;
    const path = `/node_modules/queuert/dist/${file}`;
    if (path in files) continue;
    const source = readFileSync(join(directory, file), "utf8");
    files[path] = source;
    for (const match of source.matchAll(/from "(\.\/[^"]+)"/g)) {
      const target = posix.normalize(posix.join(posix.dirname(file), match[1]));
      pending.push(target.replace(/\.mjs$/, ".d.mts"));
    }
  }
  files["/node_modules/queuert/package.json"] = JSON.stringify({
    name: "queuert",
    types: "./dist/index.d.mts",
  });
};

/**
 * Reads TypeScript's `esnext` and `webworker` libs (lessons run in a worker) and the declarations
 * `queuert` publishes, following their references, into the paths the tutorial's language service
 * reads them from.
 */
export const readTutorialTypes = (
  directories: { typescriptLib?: string; queuertDist?: string } = {},
): TutorialTypes => {
  const files: TutorialTypes = {};
  readLibs(files, directories.typescriptLib ?? typescriptLibDirectory);
  readDeclarations(files, directories.queuertDist ?? queuertDistDirectory);
  return files;
};

const virtualId = "virtual:tutorial-types";

/** Serves {@link readTutorialTypes} as `virtual:tutorial-types` to the tutorial's compiler worker. */
export const tutorialTypes = (): Plugin => ({
  name: "queuert:tutorial-types",
  resolveId: (id) => (id === virtualId ? `\0${virtualId}` : undefined),
  load(id) {
    if (id !== `\0${virtualId}`) return undefined;
    const files = readTutorialTypes();
    for (const path of Object.keys(files)) {
      if (path.startsWith("/node_modules/queuert/dist/")) {
        this.addWatchFile(
          join(queuertDistDirectory, path.slice("/node_modules/queuert/dist/".length)),
        );
      }
    }
    return `export default ${JSON.stringify(files)};`;
  },
});
