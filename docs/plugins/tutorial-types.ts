import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

/** The declaration files a tutorial lesson is type-checked against, by their virtual path. */
export type TutorialTypes = Record<string, string>;

/**
 * A package whose declarations a lesson can import, read from `directory` starting at `entry`, which
 * the package exports at `subpath` (`.` by default).
 */
export type TutorialPackage = { name: string; directory: string; entry: string; subpath?: string };

const tutorialLibs = ["esnext", "webworker", "webworker.iterable", "webworker.asynciterable"];

const require = createRequire(import.meta.url);
const typescriptLibDirectory = dirname(require.resolve("typescript"));

const packagesDirectory = fileURLToPath(new URL("../../packages", import.meta.url));
const examplesDirectory = fileURLToPath(new URL("../../examples", import.meta.url));

const packageRoot = (name: string, from: string = import.meta.url) =>
  dirname(createRequire(from).resolve(`${name}/package.json`));

const pgliteRoot = () => join(dirname(require.resolve("@electric-sql/pglite")), "..");

/**
 * The packages a lesson imports: `queuert` and its PostgreSQL and SQLite adapters from their built
 * `dist`, the drivers the lessons' `db.ts` files open, PGlite and sql.js, and the state providers
 * of the `postgresql/state-pglite` and `sqlite/state-sql-js` examples.
 */
export const tutorialPackages = (): TutorialPackage[] => {
  const sqlJsTypes = packageRoot("@types/sql.js");
  return [
    { name: "queuert", directory: join(packagesDirectory, "core"), entry: "dist/index.d.mts" },
    {
      name: "@queuert/postgres",
      directory: join(packagesDirectory, "postgres"),
      entry: "dist/index.d.mts",
    },
    {
      name: "@queuert/sqlite",
      directory: join(packagesDirectory, "sqlite"),
      entry: "dist/index.d.mts",
    },
    { name: "@electric-sql/pglite", directory: pgliteRoot(), entry: "dist/index.d.ts" },
    {
      name: "example-postgresql-state-pglite",
      directory: join(examplesDirectory, "postgresql/state-pglite"),
      entry: "src/provider.ts",
      subpath: "./provider",
    },
    {
      name: "example-sqlite-state-sql-js",
      directory: join(examplesDirectory, "sqlite/state-sql-js"),
      entry: "src/provider.ts",
      subpath: "./provider",
    },
    { name: "@types/sql.js", directory: sqlJsTypes, entry: "index.d.ts" },
    {
      name: "@types/emscripten",
      directory: packageRoot("@types/emscripten", join(sqlJsTypes, "package.json")),
      entry: "index.d.ts",
    },
  ];
};

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

const declarationOf = (file: string) => {
  if (/\.d\.[mc]?ts$/.test(file)) return file;
  if (file.endsWith(".mjs")) return file.replace(/\.mjs$/, ".d.mts");
  if (file.endsWith(".cjs")) return file.replace(/\.cjs$/, ".d.cts");
  if (file.endsWith(".js")) return file.replace(/\.js$/, ".d.ts");
  return `${file}.d.ts`;
};

const readDeclarations = (files: TutorialTypes, pkg: TutorialPackage) => {
  if (!existsSync(join(pkg.directory, pkg.entry))) {
    throw new Error(
      `${pkg.directory}/${pkg.entry} is missing: build ${pkg.name} first (pnpm --filter ${pkg.name} build)`,
    );
  }
  const pending = [pkg.entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    const path = `/node_modules/${pkg.name}/${file}`;
    if (path in files) continue;
    const source = readFileSync(join(pkg.directory, file), "utf8");
    files[path] = source;
    for (const match of source.matchAll(/(?:from |import\()["'](\.{1,2}\/[^"']+)["']/g)) {
      pending.push(declarationOf(posix.normalize(posix.join(posix.dirname(file), match[1]))));
    }
  }
  files[`/node_modules/${pkg.name}/package.json`] = JSON.stringify({
    name: pkg.name,
    exports: { [pkg.subpath ?? "."]: { types: `./${pkg.entry}` } },
  });
};

/**
 * Reads TypeScript's `esnext` and `webworker` libs (lessons run in a worker) and the declarations
 * of the {@link tutorialPackages}, following their relative references, into the paths the
 * tutorial's language service reads them from.
 */
export const readTutorialTypes = (
  options: { typescriptLib?: string; packages?: TutorialPackage[] } = {},
): TutorialTypes => {
  const files: TutorialTypes = {};
  readLibs(files, options.typescriptLib ?? typescriptLibDirectory);
  for (const pkg of options.packages ?? tutorialPackages()) readDeclarations(files, pkg);
  return files;
};

const virtualId = "virtual:tutorial-types";

/** Serves {@link readTutorialTypes} as `virtual:tutorial-types` to the tutorial's compiler worker. */
export const tutorialTypes = (): Plugin => ({
  name: "queuert:tutorial-types",
  resolveId: (id) => (id === virtualId ? `\0${virtualId}` : undefined),
  load(id) {
    if (id !== `\0${virtualId}`) return undefined;
    const packages = tutorialPackages();
    const files = readTutorialTypes({ packages });
    for (const pkg of packages) {
      for (const path of Object.keys(files)) {
        const prefix = `/node_modules/${pkg.name}/`;
        if (path.startsWith(prefix) && !path.endsWith("/package.json")) {
          this.addWatchFile(join(pkg.directory, path.slice(prefix.length)));
        }
      }
    }
    return `export default ${JSON.stringify(files)};`;
  },
});
