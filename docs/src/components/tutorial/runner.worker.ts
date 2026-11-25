import "../integrations/dashboard/demo/dispose-symbols.ts";
import * as queuert from "queuert";

import type { RunMessage, RunRequest, WorkerScope } from "./protocol.ts";
import { createChainRecorder } from "./recorder.ts";
import { executeExercise } from "./runtime.ts";

const scope = globalThis as unknown as WorkerScope<RunRequest, RunMessage>;

scope.addEventListener("message", (event) => {
  void executeExercise({
    compiled: event.data.compiled,
    modules: {
      queuert: createChainRecorder(queuert, (event) => {
        scope.postMessage({ type: "chain", event });
      }),
    },
    onLog: (log) => {
      scope.postMessage({ type: "log", log });
    },
  }).then((result) => {
    scope.postMessage({ type: "done", result });
  });
});
