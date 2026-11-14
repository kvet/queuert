import type { Plugin } from "rolldown";

import { compileSyncAsyncFunctions, SYNC_ASYNC_MODULE } from "./compile.ts";

export const syncAsyncCompiler = (
  options: {
    exclude?: RegExp;
  } = {},
) =>
  ({
    name: "queuert:sync-async-compiler",
    transform: {
      filter: {
        id: { include: /\.[cm]?[jt]sx?(?:$|\?)/, exclude: /\.d\.[cm]?ts(?:$|\?)/ },
        code: new RegExp(`["']${SYNC_ASYNC_MODULE}["']`),
      },
      handler: (code: string, id: string) => {
        if (options.exclude?.test(id) === true) return null;
        const compiled = compileSyncAsyncFunctions(code, id);
        return compiled === undefined
          ? null
          : { code: compiled.toString(), map: compiled.generateMap({ hires: true }).toString() };
      },
    },
  }) satisfies Plugin;
