import typescript from "typescript";
import types from "virtual:tutorial-types";

import { createExerciseLanguage } from "./language.ts";
import type {
  CompilerRequest,
  CompilerResponse,
  LanguageRequest,
  LanguageResponse,
  WorkerScope,
} from "./protocol.ts";
import { compileExercise, errorMessage } from "./runtime.ts";

const scope = globalThis as unknown as WorkerScope<CompilerRequest, CompilerResponse>;
const language = createExerciseLanguage(typescript, types);

const answer = (request: LanguageRequest): LanguageResponse[LanguageRequest["kind"]] => {
  switch (request.kind) {
    case "compile":
      return {
        compiled: compileExercise(typescript, request.files, request.check),
        diagnostics: language.diagnostics(request.files),
      };
    case "diagnostics":
      return language.diagnostics(request.files);
    case "quickInfo":
      return language.quickInfo(request.files, request.file, request.position);
    case "completions":
      return language.completions(request.files, request.file, request.position);
  }
};

scope.addEventListener("message", (event) => {
  try {
    scope.postMessage({ id: event.data.id, response: answer(event.data.request) });
  } catch (error) {
    scope.postMessage({ id: event.data.id, error: errorMessage(error) });
  }
});
