import type TypeScript from "typescript";

/** A lesson's files by name (`index.ts`, `job-types.ts`), the entry being `index.ts`. */
export type ExerciseFiles = Record<string, string>;

export const exerciseEntry = "index.ts";

export type ExerciseLog = { level: "log" | "info" | "warn" | "error" | "debug"; text: string };

export type CompiledExercise = {
  files: ExerciseFiles;
  check: string;
  diagnostics: string[];
};

export type ExerciseResult =
  | { status: "passed" }
  | { status: "failed"; message: string }
  | { status: "error"; message: string };

export const formatDiagnostic = (
  typescript: typeof TypeScript,
  file: string,
  diagnostic: TypeScript.Diagnostic,
) => {
  const message = typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.file === undefined || diagnostic.start === undefined) return `${file}: ${message}`;
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${file}:${line + 1}:${character + 1} ${message}`;
};

/**
 * Strips types and rewrites each file to CommonJS for {@link executeExercise}. `await using` is
 * lowered as well, so the code runs on browsers without explicit resource management. Only syntax
 * errors are reported: type checking needs the library types and is not done here.
 */
export const compileExercise = (
  typescript: typeof TypeScript,
  files: ExerciseFiles,
  check: string,
): CompiledExercise => {
  const diagnostics: string[] = [];
  const compile = (file: string, source: string) => {
    const output = typescript.transpileModule(source, {
      fileName: file,
      reportDiagnostics: true,
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022,
        sourceMap: false,
      },
    });
    for (const diagnostic of output.diagnostics ?? []) {
      diagnostics.push(formatDiagnostic(typescript, file, diagnostic));
    }
    return output.outputText;
  };
  return {
    files: Object.fromEntries(
      Object.entries(files).map(([file, source]) => [file, compile(file, source)]),
    ),
    check: compile("check.ts", check),
    diagnostics,
  };
};

const formatValue = (value: unknown, depth = 0): string => {
  if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value === null || typeof value !== "object") return String(value);
  if (depth > 3) return Array.isArray(value) ? "[Array]" : "[Object]";
  if (Array.isArray(value)) {
    return `[ ${value.map((item) => formatValue(item, depth + 1)).join(", ")} ]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) =>
      `${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${formatValue(item, depth + 1)}`,
  );
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
};

/** Formats one `console` call the way the lesson's check and the output panel read it. */
export const formatLog = (args: unknown[]): string => args.map((arg) => formatValue(arg)).join(" ");

export const errorMessage = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : formatValue(error);

type ModuleFunction = (
  require: (specifier: string) => unknown,
  exports: Record<string, unknown>,
  module: { exports: Record<string, unknown> },
  console: Pick<Console, ExerciseLog["level"]>,
) => unknown;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => ModuleFunction;

const SyncFunction = Object.getPrototypeOf(() => {}).constructor as new (
  ...args: string[]
) => ModuleFunction;

const moduleParameters = ["require", "exports", "module", "console"];

/**
 * Runs a compiled lesson: the entry `index.ts` runs to its end (top-level `await` included), then
 * the lesson's `check` reads what it logged. `modules` serves bare imports such as `queuert`;
 * relative imports (`./job-types.ts`) load the lesson's other files, which run synchronously, so
 * only the entry may use top-level `await`.
 */
export const executeExercise = async (options: {
  compiled: Pick<CompiledExercise, "files" | "check">;
  modules: Record<string, unknown>;
  onLog?: (log: ExerciseLog) => void;
}): Promise<ExerciseResult> => {
  const logs: string[] = [];
  const lessonConsole = Object.fromEntries(
    (["log", "info", "warn", "error", "debug"] as const).map((level) => [
      level,
      (...args: unknown[]) => {
        const text = formatLog(args);
        logs.push(text);
        options.onLog?.({ level, text });
      },
    ]),
  ) as Pick<Console, ExerciseLog["level"]>;

  const loaded = new Map<string, Record<string, unknown>>();
  const require = (specifier: string): unknown => {
    if (Object.hasOwn(options.modules, specifier)) return options.modules[specifier];
    const file = specifier.replace(/^\.\//, "");
    if (!specifier.startsWith("./") || !Object.hasOwn(options.compiled.files, file)) {
      throw new Error(`Cannot find module '${specifier}'`);
    }
    if (file === exerciseEntry)
      throw new Error(`'${specifier}' is the entry and cannot be imported`);
    const cached = loaded.get(file);
    if (cached !== undefined) return cached;
    const module = { exports: {} as Record<string, unknown> };
    loaded.set(file, module.exports);
    try {
      new SyncFunction(...moduleParameters, options.compiled.files[file])(
        require,
        module.exports,
        module,
        lessonConsole,
      );
    } catch (error) {
      loaded.delete(file);
      throw error;
    }
    loaded.set(file, module.exports);
    return module.exports;
  };

  const entry = options.compiled.files[exerciseEntry];
  if (entry === undefined)
    return { status: "error", message: `The lesson has no ${exerciseEntry}` };
  try {
    const module = { exports: {} as Record<string, unknown> };
    await new AsyncFunction(...moduleParameters, entry)(
      require,
      module.exports,
      module,
      lessonConsole,
    );
  } catch (error) {
    return { status: "error", message: errorMessage(error) };
  }

  try {
    const checkModule = { exports: {} as Record<string, unknown> };
    new SyncFunction(...moduleParameters, options.compiled.check)(
      require,
      checkModule.exports,
      checkModule,
      lessonConsole,
    );
    const check = checkModule.exports.check;
    if (typeof check !== "function")
      return { status: "error", message: "check.ts exports no check" };
    await check({ logs: [...logs] });
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : formatValue(error),
    };
  }
  return { status: "passed" };
};
