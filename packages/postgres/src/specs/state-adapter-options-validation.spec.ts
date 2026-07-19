import { describe, expect, it } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.js";

const dummyProvider = {
  transactionConcurrency: "concurrent" as const,
  executeSql: async () => [],
  withTransaction: async <T>(fn: (ctx: any) => Promise<T>) => fn({}),
};

it("index");

describe("SQL identifier validation", () => {
  const identifierInjectionCases: { label: string; value: string }[] = [
    { label: "SQL injection via semicolon", value: "public; DROP TABLE" },
    { label: "starts with a digit", value: "1bad" },
    { label: "contains dash", value: "my-prefix-" },
    { label: "contains space", value: "bad prefix" },
    { label: "contains quote", value: `foo'quote` },
    { label: "contains double-quote", value: `foo"quote` },
    { label: "contains backslash", value: "foo\\bar" },
    { label: "empty string", value: "" },
    { label: "SQL comment", value: "a -- comment" },
    { label: "block comment", value: "a /*x*/ b" },
  ];

  describe("rejects invalid schema", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createPgStateAdapter({ stateProvider: dummyProvider, schema: value }),
        ).rejects.toThrow(/Invalid schema/);
      });
    }
  });

  describe("rejects invalid tablePrefix", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createPgStateAdapter({ stateProvider: dummyProvider, tablePrefix: value }),
        ).rejects.toThrow(/Invalid tablePrefix/);
      });
    }
  });

  describe("rejects invalid idType", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createPgStateAdapter({ stateProvider: dummyProvider, idType: value }),
        ).rejects.toThrow(/Invalid idType/);
      });
    }
  });

  it("accepts valid schema and tablePrefix", async () => {
    const adapter = await createPgStateAdapter({
      stateProvider: dummyProvider,
      schema: "my_schema",
      tablePrefix: "qrt_",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts default values", async () => {
    const adapter = await createPgStateAdapter({ stateProvider: dummyProvider });
    expect(adapter).toBeDefined();
  });

  it("accepts typical idType value", async () => {
    const adapter = await createPgStateAdapter({
      stateProvider: dummyProvider,
      idType: "text",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts custom generateId", async () => {
    const adapter = await createPgStateAdapter({
      stateProvider: dummyProvider,
      generateId: () => "custom-id",
    });
    expect(adapter).toBeDefined();
  });
});
