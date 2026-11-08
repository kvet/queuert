import { invalidArgument } from "@queuert/rpc/server";
import { decodeIdCursor, decodeTimestampWithIdCursor } from "queuert/internal";
import * as v from "valibot";

import { MAX_IDS, MAX_PAGE_LIMIT, MAX_TYPE_NAMES } from "../../shared/limits.ts";

export const id: v.GenericSchema<string> = v.pipe(v.string(), v.minLength(1));

export const DEFAULT_PAGE_LIMIT = 50;

export const pageLimit: v.GenericSchema<number> = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(MAX_PAGE_LIMIT),
);

export type PageArguments = { cursor?: string; limit?: number };

export const pageArguments: {
  cursor: v.OptionalSchema<v.GenericSchema<string>, undefined>;
  limit: v.OptionalSchema<v.GenericSchema<number>, typeof DEFAULT_PAGE_LIMIT>;
} = { cursor: v.optional(v.string()), limit: v.optional(pageLimit, DEFAULT_PAGE_LIMIT) };

export const orderDirection: v.GenericSchema<"asc" | "desc"> = v.picklist(["asc", "desc"]);

export const ids: v.GenericSchema<string[]> = v.pipe(
  v.array(id),
  v.transform((values) => [...new Set(values)]),
  v.maxLength(MAX_IDS),
);

export const typeNames: v.GenericSchema<string[]> = v.pipe(
  v.array(id),
  v.maxLength(MAX_TYPE_NAMES),
);

export const orderByFor = <T extends string>(
  value: string | undefined,
  allowed: readonly [T, ...T[]],
): T => {
  if (value === undefined) return allowed[0];
  return (allowed as readonly string[]).includes(value)
    ? (value as T)
    : invalidArgument("data.orderBy", `expected one of ${allowed.join(", ")} for this status`);
};

export const checkCursor = (
  value: string | undefined,
  expected: { type: "id" } | { type: "timestampWithId"; sortKey: string },
): string | undefined => {
  if (value === undefined) return undefined;
  try {
    if (expected.type === "id") {
      decodeIdCursor(value);
    } else {
      decodeTimestampWithIdCursor(value, expected.sortKey);
    }
  } catch {
    return invalidArgument("data.cursor", "expected a cursor returned by the previous page");
  }
  return value;
};
