import { describe, expect, test } from "vitest";

import { createAsyncRwLock } from "./async-rw-lock.js";

describe("createAsyncRwLock", () => {
  describe("acquireWrite", () => {
    test("acquires immediately when lock is free", async () => {
      const lock = createAsyncRwLock();
      const h = await lock.acquireWrite();
      h.release();
    });

    test("blocks second acquireWrite until release", async () => {
      const lock = createAsyncRwLock();
      const order: number[] = [];

      const h1 = await lock.acquireWrite();
      order.push(1);

      const second = lock.acquireWrite().then((h) => {
        order.push(2);
        h.release();
      });

      await Promise.resolve();
      expect(order).toEqual([1]);

      h1.release();
      await second;

      expect(order).toEqual([1, 2]);
    });

    test("processes writers in FIFO order", async () => {
      const lock = createAsyncRwLock();
      const order: number[] = [];

      const h0 = await lock.acquireWrite();

      const w1 = lock.acquireWrite().then((h) => {
        order.push(1);
        h.release();
      });
      const w2 = lock.acquireWrite().then((h) => {
        order.push(2);
        h.release();
      });
      const w3 = lock.acquireWrite().then((h) => {
        order.push(3);
        h.release();
      });

      h0.release();
      await Promise.all([w1, w2, w3]);

      expect(order).toEqual([1, 2, 3]);
    });

    test("serializes concurrent writes", async () => {
      const lock = createAsyncRwLock();
      let counter = 0;
      const results: number[] = [];

      const op = async (id: number): Promise<void> => {
        const h = await lock.acquireWrite();
        try {
          const current = counter;
          await Promise.resolve();
          counter = current + 1;
          results.push(id);
        } finally {
          h.release();
        }
      };

      await Promise.all([op(1), op(2), op(3)]);

      expect(counter).toBe(3);
      expect(results).toHaveLength(3);
    });
  });

  describe("acquireRead", () => {
    test("multiple readers hold the lock concurrently", async () => {
      const lock = createAsyncRwLock();
      const h1 = await lock.acquireRead();
      const h2 = await lock.acquireRead();
      const h3 = await lock.acquireRead();
      h1.release();
      h2.release();
      h3.release();
    });

    test("readers block a pending writer", async () => {
      const lock = createAsyncRwLock();
      const order: string[] = [];

      const r1 = await lock.acquireRead();
      const r2 = await lock.acquireRead();

      const writerDone = lock.acquireWrite().then((h) => {
        order.push("w");
        h.release();
      });

      await Promise.resolve();
      expect(order).toEqual([]);

      r1.release();
      await Promise.resolve();
      expect(order).toEqual([]);

      r2.release();
      await writerDone;
      expect(order).toEqual(["w"]);
    });

    test("a pending writer blocks new readers (prevents writer starvation)", async () => {
      const lock = createAsyncRwLock();
      const order: string[] = [];

      const r1 = await lock.acquireRead();

      const writerDone = lock.acquireWrite().then((h) => {
        order.push("w");
        h.release();
      });

      const r2Done = lock.acquireRead().then((h) => {
        order.push("r2");
        h.release();
      });

      await Promise.resolve();
      expect(order).toEqual([]);

      r1.release();
      await writerDone;
      await r2Done;
      expect(order).toEqual(["w", "r2"]);
    });
  });

  describe("LockHandle", () => {
    test("release is idempotent", async () => {
      const lock = createAsyncRwLock();
      const h = await lock.acquireWrite();
      h.release();
      h.release();
      const h2 = await lock.acquireWrite();
      h2.release();
    });

    test("Symbol.dispose releases the lock", async () => {
      const lock = createAsyncRwLock();
      let pending!: Promise<{ release: () => void }>;
      let resolved = false;
      {
        using _h = await lock.acquireWrite();
        pending = lock.acquireWrite();
        void pending.then(() => {
          resolved = true;
        });
        await Promise.resolve();
        expect(resolved).toBe(false);
      }
      const h = await pending;
      expect(resolved).toBe(true);
      h.release();
    });

    test("Symbol.dispose is idempotent with release", async () => {
      const lock = createAsyncRwLock();
      const h = await lock.acquireWrite();
      h.release();
      h[Symbol.dispose]();
      const h2 = await lock.acquireWrite();
      h2.release();
    });
  });

  describe("re-acquisition", () => {
    test("can be reacquired after release", async () => {
      const lock = createAsyncRwLock();
      for (let i = 0; i < 3; i++) {
        const h = await lock.acquireWrite();
        h.release();
      }
    });

    test("read/write alternation", async () => {
      const lock = createAsyncRwLock();
      const r = await lock.acquireRead();
      r.release();
      const w = await lock.acquireWrite();
      w.release();
      const r2 = await lock.acquireRead();
      r2.release();
    });
  });
});
