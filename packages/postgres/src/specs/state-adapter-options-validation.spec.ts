import { describe, expect, it } from "vitest";

import { createPgStateAdapter } from "../state-adapter/state-adapter.pg.ts";

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

  describe("rejects invalid schema", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, () => {
        expect(() => {
          createPgStateAdapter({ stateProvider: dummyProvider, schema: value });
        }).toThrow(/Invalid schema/);
      });
    }
  });

  describe("rejects invalid tablePrefix", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, () => {
        expect(() => {
          createPgStateAdapter({ stateProvider: dummyProvider, tablePrefix: value });
        }).toThrow(/Invalid tablePrefix/);
      });
    }
  });

  describe("rejects invalid jobIdType", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, () => {
        expect(() => {
          createPgStateAdapter({ stateProvider: dummyProvider, jobIdType: value });
        }).toThrow(/Invalid jobIdType/);
      });
    }
  });

  describe("rejects invalid workerIdType", () => {
    for (const { label, value } of identifierInjectionCases) {
      it(label, () => {
        expect(() => {
          createPgStateAdapter({ stateProvider: dummyProvider, workerIdType: value });
        }).toThrow(/Invalid workerIdType/);
      });
    }
  });

  it("accepts valid schema and tablePrefix", () => {
    const adapter = createPgStateAdapter({
      stateProvider: dummyProvider,
      schema: "my_schema",
      tablePrefix: "qrt_",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts default values", () => {
    const adapter = createPgStateAdapter({ stateProvider: dummyProvider });
    expect(adapter).toBeDefined();
  });

  it("accepts typical jobIdType value", () => {
    const adapter = createPgStateAdapter({
      stateProvider: dummyProvider,
      jobIdType: "text",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts typical workerIdType value", () => {
    const adapter = createPgStateAdapter({
      stateProvider: dummyProvider,
      workerIdType: "uuid",
    });
    expect(adapter).toBeDefined();
  });

  it("accepts custom generateJobId", () => {
    const adapter = createPgStateAdapter({
      stateProvider: dummyProvider,
      generateJobId: () => "custom-id",
    });
    expect(adapter).toBeDefined();
  });
});

describe("limit validation", () => {
  for (const option of ["maxBlockersPerJob", "countCap"] as const) {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      it(`rejects ${option} = ${value}`, () => {
        expect(() => {
          createPgStateAdapter({ stateProvider: dummyProvider, [option]: value });
        }).toThrow(new RegExp(`Invalid ${option}`));
      });
    }
  }
});

describe("config", () => {
  it("applies defaults", () => {
    const { config } = createPgStateAdapter({ stateProvider: dummyProvider });
    expect(config.generateJobId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(config.validateJobId(crypto.randomUUID())).toBe(true);
    expect(config.generateWorkerId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(config.generateWorkerId()).not.toBe(config.generateWorkerId());
    expect(config.validateWorkerId(crypto.randomUUID())).toBe(true);
    expect(config.maxBlockersPerJob).toBe(100);
    expect(config.countCap).toBe(10_000);
  });

  it("exposes the configured options", () => {
    const generateJobId = () => `job-${crypto.randomUUID()}`;
    const validateJobId = (id: string) => id.startsWith("job-");
    const generateWorkerId = () => `worker-${crypto.randomUUID()}`;
    const validateWorkerId = (id: string) => id.startsWith("worker-");
    const { config } = createPgStateAdapter({
      stateProvider: dummyProvider,
      generateJobId,
      validateJobId,
      generateWorkerId,
      validateWorkerId,
      maxBlockersPerJob: 2,
      countCap: 3,
    });
    expect(config).toEqual({
      generateJobId,
      validateJobId,
      generateWorkerId,
      validateWorkerId,
      maxBlockersPerJob: 2,
      countCap: 3,
    });
  });
});
