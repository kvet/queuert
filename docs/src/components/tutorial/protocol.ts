import type { TutorialDatabase } from "./databases.ts";
import type { ExerciseCompletions, ExerciseDiagnostic, ExerciseQuickInfo } from "./language.ts";
import type { ChainEvent } from "./recorder.ts";
import type { CompiledExercise, ExerciseFiles, ExerciseLog, ExerciseResult } from "./runtime.ts";

export type LanguageRequest =
  | { kind: "compile"; files: ExerciseFiles; check: string }
  | { kind: "diagnostics"; files: ExerciseFiles }
  | { kind: "quickInfo"; files: ExerciseFiles; file: string; position: number }
  | { kind: "completions"; files: ExerciseFiles; file: string; position: number };

export type LanguageResponse = {
  compile: { compiled: CompiledExercise; diagnostics: ExerciseDiagnostic[] };
  diagnostics: ExerciseDiagnostic[];
  quickInfo: ExerciseQuickInfo | undefined;
  completions: ExerciseCompletions | undefined;
};

export type CompilerRequest = { id: number; request: LanguageRequest };
export type CompilerResponse =
  | { id: number; response: LanguageResponse[LanguageRequest["kind"]] }
  | { id: number; error: string };

export type RunRequest = {
  compiled: Pick<CompiledExercise, "files" | "check">;
  database: TutorialDatabase;
};
export type RunMessage =
  | { type: "log"; log: ExerciseLog }
  | { type: "chain"; event: ChainEvent }
  | { type: "done"; result: ExerciseResult };

/** The slice of a dedicated worker's global scope the tutorial workers use. */
export type WorkerScope<TIn, TOut> = {
  addEventListener: (type: "message", listener: (event: MessageEvent<TIn>) => void) => void;
  postMessage: (message: TOut) => void;
};
