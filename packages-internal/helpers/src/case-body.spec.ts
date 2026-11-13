import { describe, expect, test } from "vitest";

import { caseBody, resource, wait } from "./case-body.ts";
import { step } from "./steps.ts";

const createDisposable = (name: string, log: string[], error?: Error) => ({
  [Symbol.dispose]: () => {
    log.push(`dispose ${name}`);
    if (error !== undefined) throw error;
  },
});

const createAsyncDisposable = (name: string, log: string[]) => ({
  [Symbol.asyncDispose]: async () => {
    log.push(`asyncDispose ${name}`);
  },
  [Symbol.dispose]: () => {
    log.push(`dispose ${name}`);
  },
});

const createSyncAdapter = () => ({ sync: true as const, [Symbol.dispose]: () => {} });
const createAsyncAdapter = () => ({ [Symbol.asyncDispose]: async () => {} });

describe("caseBody", () => {
  test("runs steps over plain values after a sync adapter", async () => {
    const log: number[] = [];
    await caseBody(function* () {
      yield* resource(createSyncAdapter());
      const a = yield* step(1);
      const b = yield* step(a + 1);
      log.push(a, b);
    })(undefined);
    expect(log).toEqual([1, 2]);
  });

  test("fails a sync body that yields a promise through step", async () => {
    await expect(
      caseBody(function* () {
        yield* resource(createSyncAdapter());
        yield* step(Promise.resolve(1));
      })(undefined),
    ).rejects.toThrow("A synchronous step got a promise");
  });

  test("passes a sync body that yields a promise through wait", async () => {
    const log: number[] = [];
    await caseBody(function* () {
      yield* resource(createSyncAdapter());
      log.push(yield* wait(Promise.resolve(1)));
    })(undefined);
    expect(log).toEqual([1]);
  });

  test("awaits promise steps after an async adapter", async () => {
    const log: number[] = [];
    await caseBody(function* () {
      yield* resource(Promise.resolve(createAsyncAdapter()));
      log.push(yield* step(Promise.resolve(1)));
    })(undefined);
    expect(log).toEqual([1]);
  });

  test("fails an async body that yields a plain value through step", async () => {
    await expect(
      caseBody(function* () {
        yield* resource(createAsyncAdapter());
        yield* step(1);
      })(undefined),
    ).rejects.toThrow("An asynchronous step got a plain value");
  });

  test("passes a plain value through wait in async mode", async () => {
    const log: number[] = [];
    await caseBody(function* () {
      yield* resource(createAsyncAdapter());
      log.push(yield* wait(1));
    })(undefined);
    expect(log).toEqual([1]);
  });

  test("takes the mode from the first resource only", async () => {
    await expect(
      caseBody(function* () {
        yield* resource(createAsyncAdapter());
        yield* resource(createSyncAdapter());
        yield* step(1);
      })(undefined),
    ).rejects.toThrow("An asynchronous step got a plain value");
  });

  test("fails a step before the first resource", async () => {
    await expect(
      caseBody(function* () {
        yield* step(1);
      })(undefined),
    ).rejects.toThrow("A step ran before the first resource");
  });

  test("lets the body catch a synchronous throw at the call", async () => {
    const log: string[] = [];
    const fail = (): number => {
      throw new Error("boom");
    };
    await caseBody(function* () {
      yield* resource(createSyncAdapter());
      try {
        yield* step(fail());
      } catch (error) {
        log.push((error as Error).message);
      }
    })(undefined);
    expect(log).toEqual(["boom"]);
  });

  test("throws step and wait rejections back into the body", async () => {
    const log: string[] = [];
    await caseBody(function* () {
      yield* resource(createAsyncAdapter());
      try {
        yield* step(Promise.reject(new Error("step")));
      } catch (error) {
        log.push((error as Error).message);
      }
      try {
        yield* wait(Promise.reject(new Error("wait")));
      } catch (error) {
        log.push((error as Error).message);
      }
    })(undefined);
    expect(log).toEqual(["step", "wait"]);
  });

  test("fails the case when the body catches a step that breaks its mode", async () => {
    const log: string[] = [];
    await expect(
      caseBody(function* () {
        yield* resource(createSyncAdapter());
        try {
          yield* step(Promise.resolve(1));
        } catch {
          log.push("caught");
        }
      })(undefined),
    ).rejects.toThrow("A synchronous step got a promise");
    expect(log).toEqual(["caught"]);
  });

  test("runs the body's finally blocks when a step breaks its mode", async () => {
    const log: string[] = [];
    await expect(
      caseBody(function* () {
        yield* resource(createSyncAdapter());
        try {
          yield* step(Promise.resolve(1));
        } finally {
          log.push(yield* step("cleaned up"));
        }
      })(undefined),
    ).rejects.toThrow("A synchronous step got a promise");
    expect(log).toEqual(["cleaned up"]);
  });

  test("disposes resources in reverse order when the body returns", async () => {
    const log: string[] = [];
    await caseBody(function* () {
      yield* resource(createDisposable("first", log));
      yield* resource(Promise.resolve(createAsyncDisposable("second", log)));
      log.push("body");
    })(undefined);
    expect(log).toEqual(["body", "asyncDispose second", "dispose first"]);
  });

  test("disposes resources when the body throws or breaks its mode", async () => {
    const log: string[] = [];
    await expect(
      caseBody(function* () {
        yield* resource(createDisposable("thrown", log));
        throw new Error("body");
      })(undefined),
    ).rejects.toThrow("body");
    await expect(
      caseBody(function* () {
        yield* resource(createDisposable("aborted", log));
        yield* step(1);
      })(undefined),
    ).rejects.toThrow("An asynchronous step got a plain value");
    expect(log).toEqual(["dispose thrown", "dispose aborted"]);
  });

  test("suppresses the body's error with a disposal error", async () => {
    const bodyError = new Error("body");
    const disposeError = new Error("dispose");
    const result = caseBody(function* () {
      yield* resource(createDisposable("failing", [], disposeError));
      throw bodyError;
    })(undefined);
    await expect(result).rejects.toBeInstanceOf(SuppressedError);
    await expect(result).rejects.toMatchObject({ error: disposeError, suppressed: bodyError });
  });

  test("throws a disposal error when the body succeeds", async () => {
    const disposeError = new Error("dispose");
    await expect(
      caseBody(function* () {
        yield* resource(createDisposable("failing", [], disposeError));
      })(undefined),
    ).rejects.toBe(disposeError);
  });

  test("fails on a resource that is not disposable", async () => {
    await expect(
      caseBody(function* () {
        yield* resource({} as Disposable);
      })(undefined),
    ).rejects.toThrow("neither async disposable nor disposable");
  });
});
