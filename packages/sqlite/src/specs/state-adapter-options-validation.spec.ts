import { describe, expect, it } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";

const dummyProvider = {
  withTransaction: async <T>(fn: (ctx: any) => Promise<T>) => fn({}),
  isTransaction: () => true,
  executeSql: async () => [],
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

  describe("rejects invalid tablePrefix", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createSqliteStateAdapter({ stateProvider: dummyProvider, tablePrefix: value }),
        ).rejects.toThrow(/Invalid tablePrefix/);
      });
    }
  });

  describe("rejects invalid idType", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, async () => {
        await expect(
          createSqliteStateAdapter({ stateProvider: dummyProvider, idType: value }),
        ).rejects.toThrow(/Invalid idType/);
      });
    }
  });

  it("accepts valid tablePrefix", async () => {
    const adapter = await createSqliteStateAdapter({
      stateProvider: dummyProvider,
      tablePrefix: "myapp_",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts default values", async () => {
    const adapter = await createSqliteStateAdapter({ stateProvider: dummyProvider });
    expect(adapter).toBeDefined();
  });

  it("accepts typical idType value", async () => {
    const adapter = await createSqliteStateAdapter({
      stateProvider: dummyProvider,
      idType: "INTEGER",
    });
    expect(adapter).toBeDefined();
  });
});

describe("limit validation", () => {
  for (const option of ["maxBlockersPerJob", "countCap"] as const) {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      it(`rejects ${option} = ${value}`, async () => {
        await expect(
          createSqliteStateAdapter({ stateProvider: dummyProvider, [option]: value }),
        ).rejects.toThrow(new RegExp(`Invalid ${option}`));
      });
    }
  }
});

describe("config", () => {
  it("applies defaults", async () => {
    const { config } = await createSqliteStateAdapter({ stateProvider: dummyProvider });
    expect(config.generateId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(config.validateId(crypto.randomUUID())).toBe(true);
    expect(config.generateWorkerId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(config.generateWorkerId()).not.toBe(config.generateWorkerId());
    expect(config.validateWorkerId("any-worker-id")).toBe(true);
    expect(config.maxBlockersPerJob).toBe(100);
    expect(config.countCap).toBe(10_000);
  });

  it("exposes the configured options", async () => {
    const generateId = () => `job-${crypto.randomUUID()}`;
    const validateId = (id: string) => id.startsWith("job-");
    const generateWorkerId = () => `worker-${crypto.randomUUID()}`;
    const validateWorkerId = (id: string) => id.startsWith("worker-");
    const { config } = await createSqliteStateAdapter({
      stateProvider: dummyProvider,
      generateId,
      validateId,
      generateWorkerId,
      validateWorkerId,
      maxBlockersPerJob: 2,
      countCap: 3,
    });
    expect(config).toEqual({
      generateId,
      validateId,
      generateWorkerId,
      validateWorkerId,
      maxBlockersPerJob: 2,
      countCap: 3,
    });
  });
});
