import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { compileSyncAsyncFunctions } from "./compile.ts";

const fixtures = new URL("../fixtures/", import.meta.url);

describe("compileSyncAsyncFunctions", () => {
  for (const name of readdirSync(fixtures).toSorted()) {
    const read = (file: string): string =>
      readFileSync(new URL(`${name}/${file}`, fixtures), "utf8");
    const input = read("input.ts");
    const id = `${name}/input.ts`;

    if (existsSync(new URL(`${name}/error.txt`, fixtures))) {
      test(`${name}: fails with error.txt`, () => {
        expect(() => compileSyncAsyncFunctions(input, id)).toThrow(read("error.txt").trim());
      });
    } else {
      test(`${name}: compiles input.ts into output.ts`, () => {
        expect(compileSyncAsyncFunctions(input, id)?.toString() ?? input).toBe(read("output.ts"));
      });
    }
  }
});
