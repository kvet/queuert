import "../integrations/dashboard/demo/dispose-symbols.ts";
import * as pglite from "@electric-sql/pglite";
import * as postgres from "@queuert/postgres";
import * as sqlite from "@queuert/sqlite";
import * as pgliteProvider from "example-postgresql-state-pglite/provider";
import * as queuert from "queuert";
import initSqlJs from "sql.js";
import typescript from "typescript";
import { describe, expect, it } from "vitest";

import { type Exercise, listExercises, readExercise } from "../../../plugins/exercise.ts";
import { readTutorialTypes } from "../../../plugins/tutorial-types.ts";
import { type TutorialDatabase, databaseFile, tutorialDatabases } from "./databases.ts";
import { foldImports } from "./fold.ts";
import { createExerciseLanguage } from "./language.ts";
import { type ChainEvent, createChainRecorder, groupFrames, reduceChains } from "./recorder.ts";
import { compileExercise, executeExercise, formatLog } from "./runtime.ts";

const databaseModules = {
  "@electric-sql/pglite": pglite,
  "@queuert/postgres": postgres,
  "@queuert/sqlite": sqlite,
  "example-postgresql-state-pglite/provider": pgliteProvider,
  "sql.js": initSqlJs,
};

const run = async (
  files: Record<string, string>,
  check: string,
  modules: Record<string, unknown> = { queuert },
) => {
  const compiled = compileExercise(typescript, files, check);
  expect(compiled.diagnostics).toEqual([]);
  const logs: string[] = [];
  const result = await executeExercise({
    compiled,
    modules: { ...databaseModules, ...modules },
    onLog: (log) => logs.push(log.text),
  });
  return { result, logs };
};

const withDatabase = (
  exercise: Exercise,
  files: Record<string, string>,
  database: TutorialDatabase,
) => ({ ...files, [databaseFile]: exercise.databases[database] });

const lessonsOnDatabases = listExercises().flatMap((lesson) =>
  tutorialDatabases.map(({ id }) => [lesson, id] as const),
);

const passingCheck = "export const check = () => {};";

describe.each(lessonsOnDatabases)("tutorial lesson %s on %s", (lesson, database) => {
  const exercise = readExercise(lesson);

  it("passes its check with the solution", async () => {
    const { result, logs } = await run(
      withDatabase(exercise, exercise.solution, database),
      exercise.check,
    );

    expect(result, logs.join("\n")).toEqual({ status: "passed" });
  });

  it("fails its check with the start files", async () => {
    const { result } = await run(withDatabase(exercise, exercise.start, database), exercise.check);

    expect(result.status).toBe("failed");
  });
});

describe("executeExercise", () => {
  it("loads the lesson's other files through relative imports", async () => {
    const { result, logs } = await run(
      {
        "index.ts": 'import { greeting } from "./greeting.ts";\nconsole.log(greeting("ada"));',
        "greeting.ts": "export const greeting = (name: string): string => `Hello, ${name}`;",
      },
      passingCheck,
    );

    expect(result).toEqual({ status: "passed" });
    expect(logs).toEqual(["Hello, ada"]);
  });

  it("lowers await using and awaits the entry's top-level await", async () => {
    const { logs } = await run(
      {
        "index.ts": [
          "{",
          "  await using resource = { [Symbol.asyncDispose]: async () => console.log('disposed') };",
          "  await new Promise((resolve) => setTimeout(resolve, 1));",
          "  console.log('body');",
          "}",
        ].join("\n"),
      },
      passingCheck,
    );

    expect(logs).toEqual(["body", "disposed"]);
  });

  it("reports an error the entry throws", async () => {
    const { result } = await run({ "index.ts": "throw new TypeError('boom');" }, passingCheck);

    expect(result).toEqual({ status: "error", message: "TypeError: boom" });
  });

  it("reports the check's message when it throws", async () => {
    const { result } = await run(
      { "index.ts": "console.log('nothing');" },
      "export const check = ({ logs }: { logs: string[] }) => { throw new Error(`saw ${logs[0]}`); };",
    );

    expect(result).toEqual({ status: "failed", message: "saw nothing" });
  });

  it("rejects an import it cannot serve", async () => {
    const { result } = await run({ "index.ts": 'import "node:fs";' }, passingCheck);

    expect(result).toEqual({ status: "error", message: "Error: Cannot find module 'node:fs'" });
  });

  it("reports syntax errors with their position", () => {
    const compiled = compileExercise(typescript, { "index.ts": "const = 1;" }, passingCheck);

    expect(compiled.diagnostics[0]).toMatch(/^index\.ts:1:7 /);
  });
});

describe("formatLog", () => {
  it("formats strings bare and nested values like the Node console", () => {
    expect(formatLog(["Chain completed with", { sentAt: "now", ids: [1, "a"] }])).toBe(
      'Chain completed with { sentAt: "now", ids: [ 1, "a" ] }',
    );
  });
});

describe("createExerciseLanguage", () => {
  const language = createExerciseLanguage(typescript, readTutorialTypes());

  it.each(lessonsOnDatabases)(
    "type-checks lesson %s's start and solution cleanly on %s",
    (lesson, database) => {
      const exercise = readExercise(lesson);
      const diagnostics = (files: Record<string, string>) =>
        language
          .diagnostics(withDatabase(exercise, files, database))
          .map((diagnostic) => diagnostic.text);

      expect(diagnostics(exercise.start)).toEqual([]);
      expect(diagnostics(exercise.solution)).toEqual([]);
    },
  );

  it("reports a job type name queuert's types reject", () => {
    const exercise = readExercise("first-chain");
    const broken = exercise.solution["index.ts"].replace(
      'typeName: "send-welcome-email", input',
      'typeName: "send-welcome-sms", input',
    );

    const diagnostics = language.diagnostics(
      withDatabase(exercise, { "index.ts": broken }, "postgres"),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].text).toMatch(/^index\.ts:\d+:\d+ .*send-welcome-sms/s);
  });

  it("shows the declared type on hover and completes job type names", () => {
    const exercise = readExercise("first-chain");
    const source = exercise.solution["index.ts"];
    const files = withDatabase(exercise, { "index.ts": source }, "postgres");

    const hover = language.quickInfo(files, "index.ts", source.indexOf("createClient("));
    const completions = language.completions(
      withDatabase(
        exercise,
        { "index.ts": source.replace('typeName: "send-welcome-email"', 'typeName: "') },
        "postgres",
      ),
      "index.ts",
      source.indexOf('typeName: "send-welcome-email"') + 'typeName: "'.length,
    );

    expect(hover?.signature).toMatch(/^\(alias\) createClient<JobTypes<\{\s+"send-welcome-email"/);
    expect(completions?.options.map((option) => option.label)).toContain("send-welcome-email");
  });
});

describe("foldImports", () => {
  it("collapses multi-line named imports and keeps one-line ones", () => {
    const source = [
      "import {",
      "  createClient,",
      "  defineJobTypes,",
      '} from "queuert";',
      'import { jobTypes } from "./job-types.ts";',
      "",
      "const client = 1;",
    ].join("\n");

    expect(foldImports(source)).toBe(
      [
        'import {…} from "queuert";',
        'import { jobTypes } from "./job-types.ts";',
        "",
        "const client = 1;",
      ].join("\n"),
    );
  });
});

describe("createChainRecorder", () => {
  const record = async (files: Record<string, string>, check: string) => {
    const events: ChainEvent[] = [];
    const result = await executeExercise({
      compiled: compileExercise(typescript, files, check),
      modules: {
        ...databaseModules,
        queuert: createChainRecorder(queuert, (event) => events.push(event)),
      },
    });
    return { result, events };
  };

  it.each(listExercises())("records lesson %s's solution as completed chains", async (lesson) => {
    const exercise = readExercise(lesson);

    const { result, events } = await record(
      withDatabase(exercise, exercise.solution, "postgres"),
      exercise.check,
    );
    const chains = reduceChains(events);

    expect(result).toEqual({ status: "passed" });
    expect(chains.length).toBeGreaterThan(0);
    expect(chains.map((chain) => chain.status)).toEqual(chains.map(() => "completed"));
  });

  it("steps through a continued chain one commit at a time", async () => {
    const exercise = readExercise("continuing-a-chain");

    const { events } = await record(
      withDatabase(exercise, exercise.solution, "postgres"),
      exercise.check,
    );
    const frames = groupFrames(events);

    expect(frames.map((frame) => frame.map((event) => event.kind))).toEqual([
      ["chain-created", "job-created"],
      ["attempt-started"],
      ["job-created", "job-completed"],
      ["attempt-started"],
      ["job-completed", "chain-completed"],
    ]);
    expect(
      reduceChains(frames.slice(0, 3).flat()).map((chain) => ({
        status: chain.status,
        jobs: chain.jobs.map((job) => [job.typeName, job.status]),
      })),
    ).toEqual([
      {
        status: "running",
        jobs: [
          ["provision-account", "completed"],
          ["send-welcome-email", "pending"],
        ],
      },
    ]);
    expect(reduceChains(events)[0].output).toMatch(/^\{ sentAt: "/);
  });

  it("records the attempts and last error of a retried job", async () => {
    const { events } = await record(
      {
        "index.ts": [
          'import { createClient, createInProcessStateAdapter, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";',
          'const jobTypes = defineJobTypes<{ "sync-to-crm": { entry: true; input: { id: string }; output: { ok: boolean } } }>();',
          'await using stateAdapter = createInProcessStateAdapter({ mode: "async" });',
          "const client = createClient({ stateAdapter, jobTypes });",
          "const processors = createProcessors({ client, jobTypes, processors: { 'sync-to-crm': {",
          "  backoffConfig: { initialDelayMs: 1, multiplier: 1, maxDelayMs: 1 },",
          "  attemptHandler: async ({ job, applyJobOutcome }) => {",
          "    if (job.attempt < 3) throw new Error(`CRM unavailable on attempt ${job.attempt}`);",
          "    return stateAdapter.withTransaction(async (txCtx) => applyJobOutcome({ ...txCtx, output: { ok: true } }));",
          "  },",
          "} } });",
          "await using workerRunner = createWorkerRunner({ client, processors });",
          "await workerRunner.start();",
          "const chain = await stateAdapter.withTransaction(async (txCtx) =>",
          "  client.createChain({ ...txCtx, typeName: 'sync-to-crm', input: { id: 'ada' } }));",
          "await client.awaitChain({ chain, timeoutMs: 5000 });",
        ].join("\n"),
      },
      passingCheck,
    );

    const frames = groupFrames(events);
    const failedFrame = frames.findIndex((frame) => frame[0].kind === "attempt-failed");
    const [job] = reduceChains(frames.slice(0, failedFrame + 2).flat())[0].jobs;
    const [final] = reduceChains(events)[0].jobs;

    expect(job.attempts).toBe(2);
    expect(job.error).toBe("CRM unavailable on attempt 1");
    expect(final.attempts).toBe(3);
    expect(final.error).toBe("CRM unavailable on attempt 2");
    expect(final.status).toBe("completed");
  });

  it("records no chain when the transaction rolls back", async () => {
    const { result, events } = await record(
      {
        "index.ts": [
          'import { createClient, createInProcessStateAdapter, defineJobTypes } from "queuert";',
          'const jobTypes = defineJobTypes<{ "ship-order": { entry: true; input: { id: string }; output: { ok: boolean } } }>();',
          'await using stateAdapter = createInProcessStateAdapter({ mode: "async" });',
          "const client = createClient({ stateAdapter, jobTypes });",
          "await stateAdapter.withTransaction(async (txCtx) => {",
          "  await client.createChain({ ...txCtx, typeName: 'ship-order', input: { id: 'o-1' } });",
          "  throw new Error('rolled back');",
          "}).catch(() => {});",
        ].join("\n"),
      },
      passingCheck,
    );

    expect(result).toEqual({ status: "passed" });
    expect(events).toEqual([]);
    expect(reduceChains(events)).toEqual([]);
  });

  it("keeps a client's own observability adapter", async () => {
    const events: ChainEvent[] = [];
    const recorded = createChainRecorder({ createClient: (options: unknown) => options }, (event) =>
      events.push(event),
    );
    const own = { chainCreated: () => {} };

    expect(recorded.createClient({ observabilityAdapter: own })).toEqual({
      observabilityAdapter: own,
    });
  });
});

describe("executeExercise module failures", () => {
  it("evaluates a module again after it threw while loading", async () => {
    const { result, logs } = await run(
      {
        "index.ts": [
          "let attempts = 0;",
          "for (let index = 0; index < 2; index++) {",
          "  try {",
          '    await import("./flaky.ts");',
          "  } catch {",
          "    attempts++;",
          "  }",
          "}",
          "console.log(attempts);",
        ].join("\n"),
        "flaky.ts": 'console.log("loading");\nthrow new Error("broken");\nexport {};',
      },
      passingCheck,
    );

    expect(result).toEqual({ status: "passed" });
    expect(logs).toEqual(["loading", "loading", "2"]);
  });
});

describe("createChainRecorder adapter", () => {
  const adapterOf = () => {
    let adapter: Record<string, unknown> | undefined;
    createChainRecorder(
      {
        createClient: (options: { observabilityAdapter: Record<string, unknown> }) => {
          adapter = options.observabilityAdapter;
        },
      },
      () => {},
    ).createClient({} as { observabilityAdapter: Record<string, unknown> });
    return adapter!;
  };

  it("exposes every observability member as a callable and is not a thenable", () => {
    const adapter = adapterOf();

    expect(adapter.then).toBeUndefined();
    expect(Object.keys(adapter).length).toBeGreaterThan(20);
    for (const member of Object.values(adapter)) expect(typeof member).toBe("function");
    expect(() => {
      (adapter.workerStarted as () => void)();
    }).not.toThrow();
  });
});
