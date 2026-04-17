import { AssertionError } from "node:assert";

import { describe, expect as vitestExpect, it } from "vitest";

import { expect } from "./expect.js";

const assertThrows = (fn: () => void): Error => {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected function to throw");
};

const assertRejects = async (fn: () => Promise<void>): Promise<Error> => {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected function to reject");
};

describe("expect shim", () => {
  describe("toBe / toEqual", () => {
    it("toBe passes on strict equality and fails otherwise", () => {
      expect(1).toBe(1);
      expect("a").toBe("a");
      expect(null).toBe(null);
      vitestExpect(
        assertThrows(() => {
          expect(1).toBe(2);
        }),
      ).toBeInstanceOf(AssertionError);
      vitestExpect(
        assertThrows(() => {
          expect({}).toBe({});
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("toBe treats NaN as equal to NaN (Object.is semantics)", () => {
      expect(Number.NaN).toBe(Number.NaN);
    });

    it("toEqual passes on deep equality", () => {
      expect({ a: 1, b: [2, 3] }).toEqual({ a: 1, b: [2, 3] });
      vitestExpect(
        assertThrows(() => {
          expect({ a: 1 }).toEqual({ a: 2 });
        }),
      ).toBeInstanceOf(AssertionError);
    });
  });

  describe("nullish matchers", () => {
    it("toBeDefined", () => {
      expect(0).toBeDefined();
      expect(null).toBeDefined();
      vitestExpect(
        assertThrows(() => {
          expect(undefined).toBeDefined();
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("toBeUndefined", () => {
      expect(undefined).toBeUndefined();
      vitestExpect(
        assertThrows(() => {
          expect(0).toBeUndefined();
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("toBeNull", () => {
      expect(null).toBeNull();
      vitestExpect(
        assertThrows(() => {
          expect(undefined).toBeNull();
        }),
      ).toBeInstanceOf(AssertionError);
    });
  });

  describe("numeric comparisons", () => {
    it("toBeGreaterThan / toBeGreaterThanOrEqual", () => {
      expect(2).toBeGreaterThan(1);
      expect(2).toBeGreaterThanOrEqual(2);
      vitestExpect(
        assertThrows(() => {
          expect(1).toBeGreaterThan(2);
        }),
      ).toBeInstanceOf(AssertionError);
      vitestExpect(
        assertThrows(() => {
          expect(1).toBeGreaterThanOrEqual(2);
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("toBeLessThan / toBeLessThanOrEqual", () => {
      expect(1).toBeLessThan(2);
      expect(2).toBeLessThanOrEqual(2);
      vitestExpect(
        assertThrows(() => {
          expect(2).toBeLessThan(1);
        }),
      ).toBeInstanceOf(AssertionError);
    });
  });

  describe("toBeInstanceOf", () => {
    it("passes when value is an instance of the class", () => {
      class A {}
      expect(new A()).toBeInstanceOf(A);
      expect(new Error("x")).toBeInstanceOf(Error);
    });

    it("fails when value is not an instance", () => {
      class A {}
      class B {}
      vitestExpect(
        assertThrows(() => {
          expect(new A()).toBeInstanceOf(B);
        }),
      ).toBeInstanceOf(AssertionError);
    });
  });

  describe("toContain", () => {
    it("works for strings", () => {
      expect("hello world").toContain("world");
      vitestExpect(
        assertThrows(() => {
          expect("hello").toContain("world");
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("works for arrays", () => {
      expect([1, 2, 3]).toContain(2);
      vitestExpect(
        assertThrows(() => {
          expect([1, 2, 3]).toContain(4);
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("throws TypeError on non-string, non-array", () => {
      vitestExpect(() => {
        expect({}).toContain("x" as unknown);
      }).toThrow(TypeError);
    });
  });

  describe("toHaveLength", () => {
    it("passes when length matches", () => {
      expect([1, 2, 3]).toHaveLength(3);
      expect("abc").toHaveLength(3);
    });

    it("fails when length differs", () => {
      vitestExpect(
        assertThrows(() => {
          expect([1]).toHaveLength(2);
        }),
      ).toBeInstanceOf(AssertionError);
    });
  });

  describe("toThrow", () => {
    it("passes when function throws any error", () => {
      expect(() => {
        throw new Error("x");
      }).toThrow();
    });

    it("passes when error message contains string match", () => {
      expect(() => {
        throw new Error("database connection failed");
      }).toThrow("connection");
    });

    it("passes when error message matches regex", () => {
      expect(() => {
        throw new Error("request took 120ms");
      }).toThrow(/\d+ms/);
    });

    it("passes when error is instance of provided class", () => {
      class CustomError extends Error {
        override name = "CustomError";
      }
      expect(() => {
        throw new CustomError("boom");
      }).toThrow(CustomError);
    });

    it("fails when function does not throw", () => {
      vitestExpect(
        assertThrows(() => {
          expect(() => {}).toThrow();
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("fails when error does not match expected string", () => {
      vitestExpect(
        assertThrows(() => {
          expect(() => {
            throw new Error("actual");
          }).toThrow("expected");
        }),
      ).toBeInstanceOf(AssertionError);
    });
  });

  describe(".not negation", () => {
    it("inverts assertion outcome", () => {
      expect(1).not.toBe(2);
      vitestExpect(
        assertThrows(() => {
          expect(1).not.toBe(1);
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("works for toBeNull", () => {
      expect(0).not.toBeNull();
      vitestExpect(
        assertThrows(() => {
          expect(null).not.toBeNull();
        }),
      ).toBeInstanceOf(AssertionError);
    });
  });

  describe(".rejects.toThrow", () => {
    it("passes when promise rejects with matching error", async () => {
      await expect(Promise.reject(new Error("boom"))).rejects.toThrow("boom");
    });

    it("passes when promise rejects with matching class", async () => {
      class MyError extends Error {
        override name = "MyError";
      }
      await expect(Promise.reject(new MyError("x"))).rejects.toThrow(MyError);
    });

    it("fails when promise resolves", async () => {
      const err = await assertRejects(async () => expect(Promise.resolve(1)).rejects.toThrow());
      vitestExpect(err).toBeInstanceOf(AssertionError);
    });

    it("fails when rejected error does not match", async () => {
      const err = await assertRejects(async () =>
        expect(Promise.reject(new Error("actual"))).rejects.toThrow("expected"),
      );
      vitestExpect(err).toBeInstanceOf(AssertionError);
    });

    it("throws TypeError when actual is not a Promise", async () => {
      await vitestExpect(async () =>
        expect(42 as unknown as Promise<unknown>).rejects.toThrow(),
      ).rejects.toThrow(TypeError);
    });
  });

  describe("expect.poll", () => {
    it("resolves once predicate is met before timeout", async () => {
      let value = 0;
      const ticker = setInterval(() => {
        value++;
      }, 10);
      try {
        await expect.poll(() => value, { timeout: 500, interval: 10 }).toBe(3);
      } finally {
        clearInterval(ticker);
      }
    });

    it("works with async producer function", async () => {
      let value = 0;
      const ticker = setInterval(() => {
        value++;
      }, 10);
      try {
        await expect
          .poll(async () => Promise.resolve(value), { timeout: 500, interval: 10 })
          .toBe(3);
      } finally {
        clearInterval(ticker);
      }
    });

    it("rejects with AssertionError on timeout", async () => {
      const err = await assertRejects(async () =>
        expect.poll(() => 0, { timeout: 50, interval: 10 }).toBe(1),
      );
      vitestExpect(err).toBeInstanceOf(AssertionError);
      vitestExpect(err.message).toMatch(/poll timed out after 50ms/);
    });

    it("supports toEqual for deep equality", async () => {
      let state: { v: number } = { v: 0 };
      const ticker = setInterval(() => {
        state = { v: state.v + 1 };
      }, 10);
      try {
        await expect.poll(() => state, { timeout: 500, interval: 10 }).toEqual({ v: 3 });
      } finally {
        clearInterval(ticker);
      }
    });
  });

  describe("expect.fail", () => {
    it("throws AssertionError with supplied message", () => {
      const err = assertThrows(() => expect.fail("something went wrong"));
      vitestExpect(err).toBeInstanceOf(AssertionError);
      vitestExpect(err.message).toBe("something went wrong");
    });
  });

  describe("expect.skip", () => {
    it("throws a SkipSignalError carrying the reason", async () => {
      const { SkipSignalError } = await import("./runner.js");
      const err = assertThrows(() => expect.skip("no capability on this backend"));
      vitestExpect(err).toBeInstanceOf(SkipSignalError);
      vitestExpect((err as InstanceType<typeof SkipSignalError>).reason).toBe(
        "no capability on this backend",
      );
      vitestExpect(err.message).toBe("no capability on this backend");
    });
  });

  describe("toEqual — vitest compatibility", () => {
    it("ignores keys with undefined values (matches vitest)", () => {
      expect({ a: 1, b: undefined }).toEqual({ a: 1 });
      expect({ a: 1 }).toEqual({ a: 1, b: undefined });
    });

    it("compares Date instances by timestamp", () => {
      expect(new Date("2024-01-01T00:00:00Z")).toEqual(new Date("2024-01-01T00:00:00Z"));
      vitestExpect(
        assertThrows(() => {
          expect(new Date("2024-01-01T00:00:00Z")).toEqual(new Date("2024-01-02T00:00:00Z"));
        }),
      ).toBeInstanceOf(AssertionError);
    });

    it("emits actual/expected values in the error message", () => {
      const err = assertThrows(() => {
        expect({ a: 1 }).toEqual({ a: 2 });
      });
      vitestExpect(err.message).toContain("actual:");
      vitestExpect(err.message).toContain("expected:");
      vitestExpect(err.message).toContain('"a": 1');
      vitestExpect(err.message).toContain('"a": 2');
    });

    it("differs from deepStrictEqual: extra undefined keys are OK", () => {
      expect({ a: 1, c: undefined }).toEqual({ a: 1 });
    });

    it("arrays still compare element-wise", () => {
      expect([1, 2, 3]).toEqual([1, 2, 3]);
      vitestExpect(
        assertThrows(() => {
          expect([1, 2]).toEqual([1, 2, 3]);
        }),
      ).toBeInstanceOf(AssertionError);
    });
  });
});
