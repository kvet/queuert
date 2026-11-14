import { describe, expect, test } from "vitest";

import { dynamicSyncAsync } from "./dynamic-sync-async.ts";
import type { MaybePromise } from "./maybe-promise.ts";
import { resource, step, type Steps, wait } from "./steps.ts";
import { syncAsync } from "./sync-async.ts";

const createAdapter = (sync: boolean, events: string[]) => ({
  ...(sync ? { sync: true as const } : {}),
  read: (value: number): MaybePromise<number> => (sync ? value : Promise.resolve(value)),
  [Symbol.asyncDispose]: async () => void events.push(`disposed ${sync ? "sync" : "async"}`),
});

function* doubleBody(adapter: ReturnType<typeof createAdapter>, value: number) {
  return (yield* step(adapter.read(value))) * 2;
}
const double = syncAsync(doubleBody);

describe("dynamicSyncAsync", () => {
  test("runs synchronous steps after a sync resource and awaits them after an async one", async () => {
    const events: string[] = [];
    const run = dynamicSyncAsync(function* (sync: boolean) {
      const adapter = yield* resource(createAdapter(sync, events));
      const read = yield* step(adapter.read(1));
      const doubled = yield* double.steps(adapter, 2);
      yield* wait(Promise.resolve());
      events.push(`read ${read} ${doubled}`);
      return read + doubled;
    });

    expect(await run(true)).toBe(5);
    expect(await run(false)).toBe(5);
    expect(events).toEqual(["read 1 4", "disposed sync", "read 1 4", "disposed async"]);
  });

  test("fails a step that breaks the mode, even when the body catches its error", async () => {
    const events: string[] = [];
    const run = dynamicSyncAsync(function* (sync: boolean) {
      const adapter = yield* resource(createAdapter(sync, events));
      try {
        yield* step(sync ? Promise.resolve(1) : 1);
      } catch {
        events.push("caught");
      }
      return adapter !== undefined;
    });

    await expect(run(true)).rejects.toThrow(
      "A synchronous step got a promise: the value must be synchronous",
    );
    await expect(run(false)).rejects.toThrow(
      "An asynchronous step got a plain value: the value must be a promise",
    );
    expect(events).toEqual(["caught", "disposed sync", "caught", "disposed async"]);
  });

  test("takes its mode from the first resource that is not null or undefined", async () => {
    const events: string[] = [];
    const run = dynamicSyncAsync(function* () {
      yield* resource(null);
      yield* resource(undefined);
      const adapter = yield* resource(createAdapter(true, events));
      return yield* step(adapter.read(1));
    });

    expect(await run()).toBe(1);
    expect(events).toEqual(["disposed sync"]);
  });

  test("rejects an async generator body", async () => {
    const body = async function* () {
      yield* resource(null);
    };
    const run = dynamicSyncAsync(body as unknown as () => Steps<void>);

    await expect(run()).rejects.toThrow(
      "A sync-async body must be a generator function, not an async generator one",
    );
  });

  test("fails a step before the first resource", async () => {
    const run = dynamicSyncAsync(function* () {
      yield* step(1);
    });

    await expect(run()).rejects.toThrow(
      "A step ran before the first resource, so the body has no mode",
    );
  });

  test("keeps the body's error as suppressed when a disposal fails", async () => {
    const run = dynamicSyncAsync(function* () {
      yield* resource({
        [Symbol.asyncDispose]: async () => {
          throw new Error("dispose failed");
        },
      });
      throw new Error("body failed");
    });

    const error = await run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SuppressedError);
    expect((error as SuppressedError).error).toEqual(new Error("dispose failed"));
    expect((error as SuppressedError).suppressed).toEqual(new Error("body failed"));
  });
});
