import { describe, expectTypeOf, it } from "vitest";

import { defineJobTypes } from "../job-types/define-job-types.ts";
import { createInProcessStateAdapter } from "../state-adapter.in-process/state-adapter.in-process.ts";
import type { BaseTxContext, StateAdapter } from "../state-adapter/state-adapter.ts";
import { type Client, createClient } from "./client.ts";

type Defs1 = {
  "slice1.entry": {
    entry: true;
    input: { x: number };
    output: { y: number };
  };
};

type Defs2 = {
  "slice2.entry": {
    entry: true;
    input: { a: string };
    output: { b: string };
  };
};

const registry1 = defineJobTypes<Defs1>();
const registry2 = defineJobTypes<Defs2>();

const stateAdapter = createInProcessStateAdapter();
const mergedClient = createClient({
  stateAdapter,
  jobTypes: [registry1, registry2],
});

describe("Client covariance", () => {
  it("Client<A | B> is assignable to Client<A>", () => {
    const acceptDefs1Client = <TTxContext extends BaseTxContext>(
      _client: Client<Defs1, StateAdapter<TTxContext, any, any>>,
    ) => {};

    acceptDefs1Client(mergedClient);
  });

  it("Client<A | B> is assignable to Client<B>", () => {
    const acceptDefs2Client = <TTxContext extends BaseTxContext>(
      _client: Client<Defs2, StateAdapter<TTxContext, any, any>>,
    ) => {};

    acceptDefs2Client(mergedClient);
  });

  it("Client<A> is not assignable to Client<B>", () => {
    type ClientDefs1 = Client<Defs1, StateAdapter<BaseTxContext, any, any>>;
    type ClientDefs2 = Client<Defs2, StateAdapter<BaseTxContext, any, any>>;

    expectTypeOf<ClientDefs1>().not.toExtend<ClientDefs2>();
    expectTypeOf<ClientDefs2>().not.toExtend<ClientDefs1>();
  });
});
