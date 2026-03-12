import { describe, expectTypeOf, it } from "vitest";
import { type Client } from "../client.js";
import { defineJobTypeRegistry } from "../entities/define-job-type-registry.js";
import { type JobTypeRegistryNavigation } from "../entities/job-type-registry.js";
import { type ResolvedJobChain } from "../entities/job-type-registry.resolvers.js";
import { type StateAdapter } from "../state-adapter/state-adapter.js";
import { type TransactionHooks } from "../transaction-hooks.js";

const registry = defineJobTypeRegistry<{
  email: { entry: true; input: { to: string }; output: { sent: boolean } };
  sms: { entry: true; input: { phone: string }; output: { delivered: boolean } };
  dep: { entry: true; input: null; output: null };
  withBlocker: {
    entry: true;
    input: { value: number };
    output: null;
    blockers: [{ typeName: "dep" }];
  };
}>();

type Nav = JobTypeRegistryNavigation<typeof registry>;
type TestAdapter = StateAdapter<{}, string>;
type TestClient = Client<Nav, TestAdapter>;

declare const client: TestClient;
declare const transactionHooks: TransactionHooks;

describe("startJobChain types", () => {
  it("returns correctly typed chain", () => {
    const result = client.startJobChain({
      typeName: "email",
      input: { to: "test@example.com" },
      transactionHooks,
    });

    type Result = Awaited<typeof result>;
    expectTypeOf<Result["typeName"]>().toEqualTypeOf<"email">();
    expectTypeOf<Result["deduplicated"]>().toEqualTypeOf<boolean>();
  });

  it("rejects wrong input type", () => {
    void client.startJobChain({
      typeName: "email",
      // @ts-expect-error wrong input type
      input: { phone: "123" },
      transactionHooks,
    });
  });

  it("rejects non-entry type name", () => {
    void client.startJobChain({
      // @ts-expect-error non-existent type
      typeName: "nonexistent",
      input: null,
      transactionHooks,
    });
  });

  it("requires blockers when defined", () => {
    // @ts-expect-error missing required blockers
    void client.startJobChain({
      typeName: "withBlocker",
      input: { value: 1 },
      transactionHooks,
    });
  });
});

describe("startJobChains types", () => {
  it("returns tuple with per-element types for homogeneous input", () => {
    const result = client.startJobChains({
      items: [
        { typeName: "email", input: { to: "a@test.com" } },
        { typeName: "email", input: { to: "b@test.com" } },
      ],
      transactionHooks,
    });

    type Result = Awaited<typeof result>;
    expectTypeOf<Result[0]["typeName"]>().toEqualTypeOf<"email">();
    expectTypeOf<Result[0]["deduplicated"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Result[1]["typeName"]>().toEqualTypeOf<"email">();
  });

  it("returns tuple with per-element types for heterogeneous input", () => {
    const result = client.startJobChains({
      items: [
        { typeName: "email", input: { to: "a@test.com" } },
        { typeName: "sms", input: { phone: "123" } },
      ],
      transactionHooks,
    });

    type Result = Awaited<typeof result>;
    expectTypeOf<Result[0]["typeName"]>().toEqualTypeOf<"email">();
    expectTypeOf<Result[1]["typeName"]>().toEqualTypeOf<"sms">();
  });

  it("rejects wrong input type in batch element", () => {
    void client.startJobChains({
      items: [
        // @ts-expect-error wrong input for email
        { typeName: "email", input: { phone: "123" } },
      ],
      transactionHooks,
    });
  });

  it("rejects missing blockers in batch element", () => {
    void client.startJobChains({
      items: [
        // @ts-expect-error missing required blockers for withBlocker
        { typeName: "withBlocker", input: { value: 1 } },
      ],
      transactionHooks,
    });
  });

  it("accepts blockers when provided", () => {
    const depChain = null as unknown as ResolvedJobChain<string, Nav, "dep">;

    void client.startJobChains({
      items: [{ typeName: "withBlocker", input: { value: 1 }, blockers: [depChain] }],
      transactionHooks,
    });
  });

  it("returns correct length tuple", () => {
    const result = client.startJobChains({
      items: [
        { typeName: "email", input: { to: "a" } },
        { typeName: "sms", input: { phone: "1" } },
        { typeName: "email", input: { to: "b" } },
      ],
      transactionHooks,
    });

    type Result = Awaited<typeof result>;
    expectTypeOf<Result["length"]>().toEqualTypeOf<3>();
  });
});
