import { type Expect, expect as defaultExpect } from "./expect.js";
import { SkipSignalError } from "./skip-signal-error.js";

export { SkipSignalError } from "./skip-signal-error.js";

export type ConformanceCase<TContext> = {
  name: string;
  run: (context: TContext, expect: Expect) => Promise<void>;
};

export type ConformanceGroup<TContext> = {
  name: string;
  cases: ConformanceCase<TContext>[];
};

export type ConformanceResult = {
  name: string;
  status: "pass" | "fail" | "skip";
  error?: Error;
  cleanupError?: Error;
  skipReason?: string;
  durationMs: number;
};

export type ConformanceReport = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: ConformanceResult[];
};

/**
 * Error thrown when a conformance run has at least one failure.
 * `cause` is an `AggregateError` preserving original errors with stack traces.
 */
export class ConformanceError extends Error {
  readonly report: ConformanceReport;

  constructor(report: ConformanceReport) {
    const failed = report.results.filter((r) => r.status === "fail");
    const withCleanupError = report.results.filter((r) => r.cleanupError);
    const summary = `${failed.length}/${report.total} conformance cases failed (${report.passed} passed, ${report.skipped} skipped)`;
    const failureDetails = failed
      .map((r) => `  x ${r.name}\n    ${r.error?.message ?? "unknown error"}`)
      .join("\n");
    const cleanupDetails = withCleanupError.length
      ? `\nCleanup errors (${withCleanupError.length}):\n` +
        withCleanupError
          .map((r) => `  ! ${r.name}\n    ${r.cleanupError?.message ?? "unknown error"}`)
          .join("\n")
      : "";
    const causes: Error[] = [
      ...failed.map((r) => r.error ?? new Error(`${r.name} failed`)),
      ...withCleanupError.map((r) => r.cleanupError ?? new Error(`${r.name} cleanup failed`)),
    ];
    super(`${summary}\n${failureDetails}${cleanupDetails}`, {
      cause: new AggregateError(causes, summary),
    });
    this.name = "ConformanceError";
    this.report = report;
  }
}

export type ConformanceRunOptions<TContext> = {
  /**
   * Called before each case to produce an isolated test context.
   * The returned `cleanup` runs after the case regardless of outcome.
   */
  setup: () => Promise<{ context: TContext; cleanup?: () => Promise<void> }>;
  /** Optional per-case timeout (test body only). No timeout by default. */
  caseTimeoutMs?: number;
  /** Optional timeout for the `setup` callback. No timeout by default. */
  setupTimeoutMs?: number;
  /** Optional timeout for the `cleanup` callback. No timeout by default. */
  cleanupTimeoutMs?: number;
  /** Hook called after each case finishes. Errors are logged but do not abort the run. */
  onResult?: (result: ConformanceResult) => void;
};

const flatten = <TContext>(groups: ConformanceGroup<TContext>[]): ConformanceCase<TContext>[] =>
  groups.flatMap((g) =>
    g.cases.map<ConformanceCase<TContext>>((c) => ({
      name: `${g.name} > ${c.name}`,
      run: c.run,
    })),
  );

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

export const runConformance = async <TContext>(
  groups: ConformanceGroup<TContext>[],
  options: ConformanceRunOptions<TContext>,
): Promise<ConformanceReport> => {
  const cases = flatten(groups);

  const results: ConformanceResult[] = [];

  for (const testCase of cases) {
    const start = performance.now();
    let caseError: Error | undefined;
    let cleanupError: Error | undefined;
    let skipReason: string | undefined;
    let setupResult: { context: TContext; cleanup?: () => Promise<void> } | undefined;

    try {
      const setupPromise = options.setup();
      setupResult = options.setupTimeoutMs
        ? await withTimeout(setupPromise, options.setupTimeoutMs, `setup for "${testCase.name}"`)
        : await setupPromise;
    } catch (err) {
      caseError = toError(err);
    }

    if (setupResult) {
      try {
        const execution = testCase.run(setupResult.context, defaultExpect);
        if (options.caseTimeoutMs) {
          await withTimeout(execution, options.caseTimeoutMs, `case "${testCase.name}"`);
        } else {
          await execution;
        }
      } catch (err) {
        if (err instanceof SkipSignalError) {
          skipReason = err.reason;
        } else {
          caseError = toError(err);
        }
      } finally {
        if (setupResult.cleanup) {
          try {
            const cleanupPromise = setupResult.cleanup();
            if (options.cleanupTimeoutMs) {
              await withTimeout(
                cleanupPromise,
                options.cleanupTimeoutMs,
                `cleanup for "${testCase.name}"`,
              );
            } else {
              await cleanupPromise;
            }
          } catch (cleanupErr) {
            const err = toError(cleanupErr);
            if (caseError) {
              cleanupError = err;
            } else {
              caseError = err;
            }
          }
        }
      }
    }

    const status: ConformanceResult["status"] = caseError
      ? "fail"
      : skipReason !== undefined
        ? "skip"
        : "pass";
    const result: ConformanceResult = {
      name: testCase.name,
      status,
      error: caseError,
      cleanupError,
      skipReason,
      durationMs: performance.now() - start,
    };
    results.push(result);

    if (options.onResult) {
      try {
        options.onResult(result);
      } catch (err) {
        console.warn(`onResult threw for "${testCase.name}":`, err);
      }
    }
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  const failed = results.length - passed - skipped;
  const report: ConformanceReport = {
    total: results.length,
    passed,
    failed,
    skipped,
    results,
  };

  if (failed > 0) {
    throw new ConformanceError(report);
  }
  return report;
};
