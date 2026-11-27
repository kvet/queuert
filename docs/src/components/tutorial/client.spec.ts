import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event: any) => void;

const createFakeWorkers = () => {
  const workers: {
    url: string;
    posted: any[];
    terminated: boolean;
    emit: (type: string, event: unknown) => void;
  }[] = [];
  class FakeWorker {
    listeners = new Map<string, Listener[]>();
    posted: any[] = [];
    terminated = false;
    url: string;
    constructor(url: URL) {
      this.url = url.pathname;
      workers.push(this);
    }
    addEventListener(type: string, listener: Listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    postMessage(message: unknown) {
      this.posted.push(message);
    }
    terminate() {
      this.terminated = true;
    }
    emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  return workers;
};

describe("client", () => {
  let workers: ReturnType<typeof createFakeWorkers>;

  beforeEach(() => {
    vi.resetModules();
    workers = createFakeWorkers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("rejects a request the compiler answers with an error", async () => {
    const { exerciseLanguage } = await import("./client.ts");

    const diagnostics = exerciseLanguage.diagnostics({ "index.ts": "" });
    workers[0].emit("message", { data: { id: workers[0].posted[0].id, error: "boom" } });

    await expect(diagnostics).rejects.toThrow("boom");
  });

  it("rejects every pending request and recreates the compiler after it fails", async () => {
    const { exerciseLanguage } = await import("./client.ts");

    const first = exerciseLanguage.diagnostics({ "index.ts": "" });
    const second = exerciseLanguage.completions({ "index.ts": "" }, "index.ts", 0);
    workers[0].emit("error", { message: "load failed" });

    await expect(first).rejects.toThrow("load failed");
    await expect(second).rejects.toThrow("load failed");
    expect(workers[0].terminated).toBe(true);

    const third = exerciseLanguage.diagnostics({ "index.ts": "" });
    expect(workers).toHaveLength(2);
    workers[1].emit("message", { data: { id: workers[1].posted[0].id, response: [] } });
    await expect(third).resolves.toEqual([]);
  });

  it("settles a run with the compiler's error", async () => {
    const { runExercise } = await import("./client.ts");

    const run = runExercise({
      files: { "index.ts": "" },
      database: "postgres",
      check: "",
      onLog: () => {},
      onChainEvent: () => {},
    });
    workers[0].emit("message", { data: { id: workers[0].posted[0].id, error: "compile broke" } });

    await expect(run.result).resolves.toEqual({ status: "error", message: "Error: compile broke" });
  });

  it("times out a run whose compile never answers", async () => {
    vi.useFakeTimers();
    const { runExercise } = await import("./client.ts");

    const run = runExercise({
      files: { "index.ts": "" },
      database: "postgres",
      check: "",
      onLog: () => {},
      onChainEvent: () => {},
    });
    await vi.advanceTimersByTimeAsync(15_001);

    await expect(run.result).resolves.toEqual({
      status: "error",
      message:
        "The run did not finish within 15s. A query inside a transaction that is not given its txCtx, such as sql() in place of sql(txCtx), waits for that transaction and never runs.",
    });
    expect(workers).toHaveLength(1);
  });

  it("counts the compile toward the run timeout", async () => {
    vi.useFakeTimers();
    const { runExercise } = await import("./client.ts");

    const run = runExercise({
      files: { "index.ts": "" },
      database: "postgres",
      check: "",
      onLog: () => {},
      onChainEvent: () => {},
    });
    await vi.advanceTimersByTimeAsync(10_000);
    workers[0].emit("message", {
      data: {
        id: workers[0].posted[0].id,
        response: { compiled: { files: {}, check: "", diagnostics: [] }, diagnostics: [] },
      },
    });
    await vi.advanceTimersByTimeAsync(4_999);

    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);

    await vi.advanceTimersByTimeAsync(2);

    await expect(run.result).resolves.toEqual({
      status: "error",
      message:
        "The run did not finish within 15s. A query inside a transaction that is not given its txCtx, such as sql() in place of sql(txCtx), waits for that transaction and never runs.",
    });
    expect(workers[1].terminated).toBe(true);
  });
});
