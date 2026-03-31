import { describe, expectTypeOf, it } from "vitest";

import { type Client, createClient } from "./client.js";
import { defineJobTypeRegistry } from "./entities/define-job-type-registry.js";
import { mergeJobTypeRegistries } from "./entities/merge-job-type-registries.js";
import { createInProcessStateAdapter } from "./state-adapter/state-adapter.in-process.js";
import { type BaseTxContext, type StateAdapter } from "./state-adapter/state-adapter.js";

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

const registry1 = defineJobTypeRegistry<Defs1>();
const registry2 = defineJobTypeRegistry<Defs2>();

const stateAdapter = createInProcessStateAdapter();
const mergedClient = await createClient({
  stateAdapter,
  jobTypeRegistry: mergeJobTypeRegistries({
    slices: [registry1, registry2],
  }),
});

describe("Client covariance", () => {
  it("Client<A | B> is assignable to Client<A>", () => {
    const acceptDefs1Client = <TTxContext extends BaseTxContext>(
      _client: Client<Defs1, StateAdapter<TTxContext, any>>,
    ) => {};

    acceptDefs1Client(mergedClient);
  });

  it("Client<A | B> is assignable to Client<B>", () => {
    const acceptDefs2Client = <TTxContext extends BaseTxContext>(
      _client: Client<Defs2, StateAdapter<TTxContext, any>>,
    ) => {};

    acceptDefs2Client(mergedClient);
  });

  it("Client<A> is not assignable to Client<B>", () => {
    type ClientDefs1 = Client<Defs1, StateAdapter<BaseTxContext, any>>;
    type ClientDefs2 = Client<Defs2, StateAdapter<BaseTxContext, any>>;

    expectTypeOf<ClientDefs1>().not.toExtend<ClientDefs2>();
  });
});
