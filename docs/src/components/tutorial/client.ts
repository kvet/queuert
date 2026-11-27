import type { TutorialDatabase } from "./databases.ts";
import type { ExerciseLanguage } from "./language.ts";
import type {
  CompilerRequest,
  CompilerResponse,
  LanguageRequest,
  LanguageResponse,
  RunMessage,
  RunRequest,
} from "./protocol.ts";
import type { ChainEvent } from "./recorder.ts";
import {
  type ExerciseFiles,
  type ExerciseLog,
  type ExerciseResult,
  errorMessage,
} from "./runtime.ts";

const runTimeoutMs = 15_000;

let compiler: Worker | undefined;
let nextRequestId = 0;
const pending = new Map<
  number,
  { resolve: (response: CompilerResponse) => void; reject: (error: Error) => void }
>();

const failPending = (message: string) => {
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) entry.reject(new Error(message));
};

const createCompiler = () => {
  const worker = new Worker(new URL("./compiler.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<CompilerResponse>) => {
    const entry = pending.get(event.data.id);
    pending.delete(event.data.id);
    if ("error" in event.data) entry?.reject(new Error(event.data.error));
    else entry?.resolve(event.data);
  });
  worker.addEventListener("error", (event) => {
    if (compiler === worker) compiler = undefined;
    worker.terminate();
    failPending(event.message || "The compiler failed to load");
  });
  return worker;
};

const ask = async <TRequest extends LanguageRequest>(
  request: TRequest,
): Promise<LanguageResponse[TRequest["kind"]]> => {
  compiler ??= createCompiler();
  const worker = compiler;
  const id = nextRequestId++;
  const message: CompilerRequest = { id, request };
  const answer = await new Promise<CompilerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(message);
  });
  return (answer as unknown as { response: LanguageResponse[TRequest["kind"]] }).response;
};

/** The compiler worker's language features, as the editor calls them. */
export type ExerciseLanguageClient = {
  [TKey in keyof ExerciseLanguage]: (
    ...args: Parameters<ExerciseLanguage[TKey]>
  ) => Promise<ReturnType<ExerciseLanguage[TKey]>>;
};

export const exerciseLanguage: ExerciseLanguageClient = {
  diagnostics: async (files) => ask({ kind: "diagnostics", files }),
  quickInfo: async (files, file, position) => ask({ kind: "quickInfo", files, file, position }),
  completions: async (files, file, position) => ask({ kind: "completions", files, file, position }),
};

/** A run in progress; `cancel` stops its worker and settles `result` as an error. */
export type ExerciseRun = { result: Promise<ExerciseResult>; cancel: () => void };

/**
 * Type-checks and compiles the reader's files in the long-lived compiler worker, refusing to run
 * them while they have type errors, then runs them in a fresh runner worker that is terminated once
 * the entry and the check finish, so a worker runner left running or an endless loop never outlives
 * its run. A run that has not finished within 15 seconds of its start, compiling included, settles
 * as an error.
 */
export const runExercise = (options: {
  files: ExerciseFiles;
  database: TutorialDatabase;
  check: string;
  onLog: (log: ExerciseLog) => void;
  onChainEvent: (event: ChainEvent) => void;
}): ExerciseRun => {
  let runner: Worker | undefined;
  let settle: (result: ExerciseResult) => void = () => {};
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<ExerciseResult>((resolve) => {
    settle = (value) => {
      if (settled) return;
      settled = true;
      runner?.terminate();
      clearTimeout(timeout);
      resolve(value);
    };
  });

  timeout = setTimeout(() => {
    settle({
      status: "error",
      message: `The run did not finish within ${runTimeoutMs / 1000}s. A query inside a transaction that is not given its txCtx, such as sql() in place of sql(txCtx), waits for that transaction and never runs.`,
    });
  }, runTimeoutMs);
  void ask({ kind: "compile", files: options.files, check: options.check })
    .then(({ compiled, diagnostics }) => {
      if (settled) return;
      const errors = [
        ...compiled.diagnostics,
        ...diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.text),
      ];
      if (errors.length > 0) {
        settle({ status: "error", message: [...new Set(errors)].join("\n") });
        return;
      }
      runner = new Worker(new URL("./runner.worker.ts", import.meta.url), { type: "module" });
      runner.addEventListener("message", (event: MessageEvent<RunMessage>) => {
        if (event.data.type === "log") options.onLog(event.data.log);
        else if (event.data.type === "chain") options.onChainEvent(event.data.event);
        else settle(event.data.result);
      });
      runner.addEventListener("error", (event) => {
        settle({ status: "error", message: event.message || "The run crashed" });
      });
      const request: RunRequest = {
        compiled: { files: compiled.files, check: compiled.check },
        database: options.database,
      };
      runner.postMessage(request);
    })
    .catch((error: unknown) => {
      settle({ status: "error", message: errorMessage(error) });
    });

  return {
    result,
    cancel: () => {
      settle({ status: "error", message: "Stopped" });
    },
  };
};
