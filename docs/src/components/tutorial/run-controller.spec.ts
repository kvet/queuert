import { describe, expect, it } from "vitest";

import type { ExerciseRun } from "./client.ts";
import { createRunController } from "./run-controller.ts";
import type { ExerciseResult } from "./runtime.ts";

const createFakeRun = () => {
  let resolve: (result: ExerciseResult) => void = () => {};
  const result = new Promise<ExerciseResult>((done) => {
    resolve = done;
  });
  let cancelled = 0;
  const run: ExerciseRun = {
    result,
    cancel: () => {
      cancelled++;
      resolve({ status: "error", message: "Stopped" });
    },
  };
  return { run, finish: resolve, cancelled: () => cancelled };
};

const setup = () => {
  const runs: ReturnType<typeof createFakeRun>[] = [];
  const handlers: Parameters<Parameters<typeof createRunController>[0]["launch"]>[0][] = [];
  const gates: (() => void)[] = [];
  const seen = { starts: 0, results: [] as ExerciseResult[], logs: [] as string[], events: 0 };
  const controller = createRunController({
    launch: async (given) => {
      const fake = createFakeRun();
      runs.push(fake);
      handlers.push(given);
      await new Promise<void>((open) => gates.push(open));
      return fake.run;
    },
    onStart: () => seen.starts++,
    onLog: (log) => seen.logs.push(log.text),
    onChainEvent: () => seen.events++,
    onFinish: (result) => seen.results.push(result),
  });
  const tick = async () => {
    for (let index = 0; index < 5; index++) await Promise.resolve();
  };
  return { controller, runs, handlers, gates, seen, tick };
};

describe("createRunController", () => {
  it("finishes a run with its result", async () => {
    const { controller, runs, gates, seen, tick } = setup();

    const done = controller.run();
    gates[0]();
    await tick();
    expect(controller.isFinished()).toBe(false);
    runs[0].finish({ status: "passed" });
    await done;

    expect(seen.results).toEqual([{ status: "passed" }]);
    expect(controller.isFinished()).toBe(true);
  });

  it("ignores the first run entirely when re-run during its launch", async () => {
    const { controller, runs, handlers, gates, seen, tick } = setup();

    const first = controller.run();
    const second = controller.run();
    gates[0]();
    gates[1]();
    await tick();
    handlers[0].onLog({ level: "log", text: "stale" });
    handlers[1].onLog({ level: "log", text: "fresh" });
    runs[1].finish({ status: "passed" });
    await Promise.all([first, second]);

    expect(runs[0].cancelled()).toBe(1);
    expect(seen.logs).toEqual(["fresh"]);
    expect(seen.results).toEqual([{ status: "passed" }]);
    expect(controller.isFinished()).toBe(true);
  });

  it("cancels the previous run when re-run while it is running", async () => {
    const { controller, runs, handlers, gates, seen, tick } = setup();

    const first = controller.run();
    gates[0]();
    await tick();
    const second = controller.run();
    gates[1]();
    await tick();
    handlers[0].onChainEvent({ kind: "chain-created", chainId: "a", typeName: "x" });

    expect(runs[0].cancelled()).toBe(1);
    expect(seen.events).toBe(0);
    expect(controller.isFinished()).toBe(false);

    runs[1].finish({ status: "failed", message: "no" });
    await Promise.all([first, second]);

    expect(seen.results).toEqual([{ status: "failed", message: "no" }]);
  });

  it("ignores a cancelled run's late result", async () => {
    const { controller, runs, gates, seen, tick } = setup();

    const first = controller.run();
    gates[0]();
    await tick();
    controller.cancel();
    runs[0].finish({ status: "passed" });
    await first;

    expect(seen.results).toEqual([]);
    expect(controller.isFinished()).toBe(true);
  });

  it("cancels a run that is still launching when reset", async () => {
    const { controller, runs, gates, seen } = setup();

    const first = controller.run();
    controller.cancel();
    gates[0]();
    await first;

    expect(runs[0].cancelled()).toBe(1);
    expect(seen.results).toEqual([]);
    expect(controller.isFinished()).toBe(true);
  });

  it("reports a launch failure as an error result", async () => {
    const results: ExerciseResult[] = [];
    const controller = createRunController({
      launch: async () => {
        throw new Error("no client");
      },
      onStart: () => {},
      onLog: () => {},
      onChainEvent: () => {},
      onFinish: (result) => results.push(result),
    });

    await controller.run();

    expect(results).toEqual([{ status: "error", message: "Error: no client" }]);
    expect(controller.isFinished()).toBe(true);
  });
});
