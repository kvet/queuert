import { describe, expect, it } from "vitest";

import {
  createSortedList,
  deleteFromSortedList,
  firstOfSortedList,
  insertIntoSortedList,
  sortedListToArray,
  takeFromSortedList,
} from "./sorted-list.ts";

const compareNumbers = (a: number, b: number): number => a - b;

const scatter = (step: number, salt: number, max: number): number =>
  (((step + salt) * 2_654_435_761) % 4_294_967_296) % max;

describe("SortedList", () => {
  it("matches a sorted array across inserts and deletes that split and empty chunks", () => {
    const list = createSortedList(compareNumbers);
    const reference = new Set<number>();

    for (let step = 0; step < 20_000; step++) {
      const value = scatter(step, 0, 3_000);
      const roll = scatter(step, 7, 4);
      if (step < 12_000 ? roll !== 0 : roll === 0) {
        if (!reference.has(value)) insertIntoSortedList(list, value);
        reference.add(value);
      } else {
        expect(deleteFromSortedList(list, value)).toBe(reference.has(value));
        reference.delete(value);
      }

      if (step % 500 === 0 || step === 19_999) {
        const expected = [...reference].toSorted(compareNumbers);
        expect(sortedListToArray(list)).toEqual(expected);
        expect(list.size).toBe(expected.length);
        expect(firstOfSortedList(list)).toBe(expected[0]);
      }
    }
  });

  it("drains in order when every item is taken from the front", () => {
    const list = createSortedList(compareNumbers);
    for (let value = 2_000; value > 0; value--) insertIntoSortedList(list, value);

    const takeFirst = (): number | undefined => {
      const item = firstOfSortedList(list);
      if (item !== undefined) deleteFromSortedList(list, item);
      return item;
    };

    expect(Array.from({ length: 2_000 }, takeFirst)).toEqual(
      Array.from({ length: 2_000 }, (_, i) => i + 1),
    );
    expect(firstOfSortedList(list)).toBeUndefined();
    expect(list.size).toBe(0);
  });

  it("starts from already sorted items and keeps accepting inserts", () => {
    const list = createSortedList(
      compareNumbers,
      Array.from({ length: 1_000 }, (_, i) => i * 2),
    );
    insertIntoSortedList(list, 501);
    insertIntoSortedList(list, 5_000);

    expect(list.size).toBe(1_002);
    expect(takeFromSortedList(list, "asc", (item) => item < 500, undefined, 3)).toEqual([
      500, 501, 502,
    ]);
    expect(takeFromSortedList(list, "desc", () => false, undefined, 2)).toEqual([5_000, 1_998]);
  });

  it("ignores deleting an item it does not hold", () => {
    const list = createSortedList(compareNumbers);
    expect(deleteFromSortedList(list, 1)).toBe(false);
    insertIntoSortedList(list, 2);
    expect(deleteFromSortedList(list, 1)).toBe(false);
    expect(deleteFromSortedList(list, 3)).toBe(false);

    expect(sortedListToArray(list)).toEqual([2]);
  });

  describe("take", () => {
    const values = Array.from({ length: 3_000 }, (_, i) => i);
    const list = createSortedList(compareNumbers, values);

    it("skips the leading run ascending and stops before the first stop item", () => {
      expect(
        takeFromSortedList(
          list,
          "asc",
          (item) => item <= 1_499,
          (item) => item > 1_502,
          10,
        ),
      ).toEqual([1_500, 1_501, 1_502]);
    });

    it("skips the trailing run descending and crosses chunk boundaries", () => {
      expect(takeFromSortedList(list, "desc", (item) => item >= 1_000, undefined, 600)).toEqual(
        values.slice(400, 1_000).toReversed(),
      );
    });

    it("returns nothing when every item is skipped or the limit is zero", () => {
      expect(takeFromSortedList(list, "asc", () => true, undefined, 5)).toEqual([]);
      expect(takeFromSortedList(list, "desc", () => true, undefined, 5)).toEqual([]);
      expect(takeFromSortedList(list, "asc", () => false, undefined, 0)).toEqual([]);
    });

    it("walks the whole list from either end", () => {
      expect(takeFromSortedList(list, "asc", () => false, undefined, 5_000)).toEqual(values);
      expect(takeFromSortedList(list, "desc", () => false, undefined, 5_000)).toEqual(
        values.toReversed(),
      );
    });
  });
});
