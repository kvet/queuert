import type TypeScript from "typescript";

import { type ExerciseFiles, formatDiagnostic } from "./runtime.ts";

export type ExerciseDiagnostic = {
  file: string;
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
  /** `index.ts:12:3 message`, as the output panel shows it. */
  text: string;
};

export type ExerciseQuickInfo = {
  from: number;
  to: number;
  signature: string;
  documentation: string;
};

export type ExerciseCompletions = {
  from: number;
  options: { label: string; kind: string; sortText: string }[];
};

/** The language features the editor asks the compiler worker for. */
export type ExerciseLanguage = {
  diagnostics: (files: ExerciseFiles) => ExerciseDiagnostic[];
  quickInfo: (
    files: ExerciseFiles,
    file: string,
    position: number,
  ) => ExerciseQuickInfo | undefined;
  completions: (
    files: ExerciseFiles,
    file: string,
    position: number,
  ) => ExerciseCompletions | undefined;
};

/**
 * A TypeScript language service over a lesson's files, checked the way the examples are (strict,
 * `.ts` imports) against `types`: the `esnext` and `webworker` libs and the declarations `queuert`
 * publishes, as `readTutorialTypes` reads them.
 */
export const createExerciseLanguage = (
  typescript: typeof TypeScript,
  types: Record<string, string>,
): ExerciseLanguage => {
  const userFiles = new Map<string, { source: string; version: number }>();
  const pathOf = (file: string) => `/${file}`;

  const options: TypeScript.CompilerOptions = {
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.Bundler,
    lib: [
      "lib.esnext.d.ts",
      "lib.webworker.d.ts",
      "lib.webworker.iterable.d.ts",
      "lib.webworker.asynciterable.d.ts",
    ],
    strict: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    types: [],
  };

  const readFile = (path: string): string | undefined => {
    return userFiles.get(path.slice(1))?.source ?? types[path];
  };

  const host: TypeScript.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...userFiles.keys()].map(pathOf),
    getScriptVersion: (path) => String(userFiles.get(path.slice(1))?.version ?? 0),
    getScriptSnapshot: (path) => {
      const source = readFile(path);
      return source === undefined ? undefined : typescript.ScriptSnapshot.fromString(source);
    },
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => "/lib/lib.esnext.d.ts",
    fileExists: (path) => readFile(path) !== undefined,
    readFile,
    directoryExists: (directory) =>
      directory === "/" ||
      Object.keys(types).some((path) => path.startsWith(`${directory.replace(/\/$/, "")}/`)),
    getDirectories: () => [],
  };
  const service = typescript.createLanguageService(host, typescript.createDocumentRegistry());

  const sync = (files: ExerciseFiles) => {
    for (const file of userFiles.keys()) if (!(file in files)) userFiles.delete(file);
    for (const [file, source] of Object.entries(files)) {
      const current = userFiles.get(file);
      if (current?.source !== source) {
        userFiles.set(file, { source, version: (current?.version ?? 0) + 1 });
      }
    }
  };

  const toDiagnostic = (file: string, diagnostic: TypeScript.Diagnostic): ExerciseDiagnostic => {
    const from = diagnostic.start ?? 0;
    return {
      file,
      from,
      to: from + (diagnostic.length ?? 0),
      severity: diagnostic.category === typescript.DiagnosticCategory.Error ? "error" : "warning",
      message: typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      text: formatDiagnostic(typescript, file, diagnostic),
    };
  };

  return {
    diagnostics: (files) => {
      sync(files);
      return Object.keys(files).flatMap((file) =>
        [
          ...service.getSyntacticDiagnostics(pathOf(file)),
          ...service.getSemanticDiagnostics(pathOf(file)),
        ].map((diagnostic) => toDiagnostic(file, diagnostic)),
      );
    },
    quickInfo: (files, file, position) => {
      sync(files);
      const info = service.getQuickInfoAtPosition(pathOf(file), position);
      if (info === undefined) return undefined;
      return {
        from: info.textSpan.start,
        to: info.textSpan.start + info.textSpan.length,
        signature: typescript.displayPartsToString(info.displayParts),
        documentation: typescript.displayPartsToString(info.documentation),
      };
    },
    completions: (files, file, position) => {
      sync(files);
      const completions = service.getCompletionsAtPosition(pathOf(file), position, {
        includeCompletionsWithInsertText: true,
      });
      if (completions === undefined) return undefined;
      const source = files[file] ?? "";
      let from = position;
      while (from > 0 && /[\w$]/.test(source[from - 1])) from--;
      const span =
        completions.optionalReplacementSpan ??
        completions.entries.find((entry) => entry.replacementSpan)?.replacementSpan;
      return {
        from: span?.start ?? from,
        options: completions.entries.map((entry) => ({
          label: entry.name,
          kind: entry.kind,
          sortText: entry.sortText,
        })),
      };
    },
  };
};
