import "../integrations/dashboard/demo/dispose-symbols.ts";
import * as queuert from "queuert";
import type { SqlJsConfig } from "sql.js";

import type { TutorialDatabase } from "./databases.ts";
import type { RunMessage, RunRequest, WorkerScope } from "./protocol.ts";
import { createChainRecorder } from "./recorder.ts";
import { type ExerciseResult, errorMessage, executeExercise } from "./runtime.ts";

const scope = globalThis as unknown as WorkerScope<RunRequest, RunMessage>;

const databaseModules = async (database: TutorialDatabase): Promise<Record<string, unknown>> => {
  if (database === "postgres") {
    const [pglite, postgres, provider] = await Promise.all([
      import("@electric-sql/pglite"),
      import("@queuert/postgres"),
      import("example-postgresql-state-pglite/provider"),
    ]);
    return {
      "@electric-sql/pglite": pglite,
      "@queuert/postgres": postgres,
      "example-postgresql-state-pglite/provider": provider,
    };
  }
  const [sqlJs, sqlite, wasm] = await Promise.all([
    import("sql.js"),
    import("@queuert/sqlite"),
    import("sql.js/dist/sql-wasm-browser.wasm?url"),
  ]);
  const initSqlJs = async (config: SqlJsConfig) =>
    sqlJs.default({ ...config, locateFile: () => wasm.default });
  return { "sql.js": initSqlJs, "@queuert/sqlite": sqlite };
};

scope.addEventListener("message", (event) => {
  void databaseModules(event.data.database)
    .then(async (modules) =>
      executeExercise({
        compiled: event.data.compiled,
        modules: {
          ...modules,
          queuert: createChainRecorder(queuert, (event) => {
            scope.postMessage({ type: "chain", event });
          }),
        },
        onLog: (log) => {
          scope.postMessage({ type: "log", log });
        },
      }),
    )
    .catch((error: unknown): ExerciseResult => ({ status: "error", message: errorMessage(error) }))
    .then((result) => {
      scope.postMessage({ type: "done", result });
    });
});
