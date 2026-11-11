import type { JobTypes } from "../job-types/job-types.ts";

/**
 * Builders that the adapter author supplies to satisfy the validation
 * conformance suite. Each builder's RETURN TYPE encodes the expected phantom
 * job type definitions, so the adapter's schema-to-shape mapper must thread
 * inference correctly to type-check where the context is declared.
 *
 * Conformance verifies the wrapper layer only — the eight runtime methods and
 * the way they integrate with core's `createJobTypes` error wrapping.
 * Compile-time validation rules (rejecting blockers that reference
 * continuation-only types, etc.) live in core's `ValidatedJobTypeDefinitions`
 * and are tested there; the positive type checks below are sufficient to
 * prove the adapter feeds them correctly.
 */
export type ValidationAdapterConformanceContext = {
  basic: {
    /** main: entry, input { id: string }, output { ok: boolean } — no continueWith, no blockers. */
    buildEntry: () => JobTypes<{
      main: {
        entry: true;
        input: { id: string };
        output: { ok: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
    /** internal: non-entry, input { id: string }, output { ok: boolean }. */
    buildNonEntry: () => JobTypes<{
      internal: {
        entry: undefined;
        input: { id: string };
        output: { ok: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
    /**
     * main → next (continuation-only entry):
     *   main: entry, input { id: string }, no output, continueWith nominal "next".
     *   next: non-entry, input { data: string }, output { done: boolean }.
     */
    buildContinuationOnly: () => JobTypes<{
      main: {
        entry: true;
        input: { id: string };
        output: undefined;
        continueWith: { typeName: "next" };
        blockers: undefined;
      };
      next: {
        entry: undefined;
        input: { data: string };
        output: { done: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
  };

  continuations: {
    /** step1 → step2 (nominal continueWith by name). */
    buildNominal: () => JobTypes<{
      step1: {
        entry: true;
        input: { id: string };
        output: undefined;
        continueWith: { typeName: "step2" };
        blockers: undefined;
      };
      step2: {
        entry: undefined;
        input: { data: unknown };
        output: { done: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
    /** router → handler (structural continueWith by input shape). */
    buildStructural: () => JobTypes<{
      router: {
        entry: true;
        input: { route: string };
        output: undefined;
        continueWith: { input: { payload: string } };
        blockers: undefined;
      };
      handler: {
        entry: undefined;
        input: { payload: string };
        output: { handled: boolean };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
  };

  blockers: {
    /** main blocked nominally by 'auth'. */
    buildNominal: () => JobTypes<{
      main: {
        entry: true;
        input: { id: string };
        output: { done: boolean };
        continueWith: undefined;
        blockers: readonly { typeName: "auth" }[];
      };
      auth: {
        entry: true;
        input: { token: string };
        output: { userId: string };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
    /** main blocked structurally by anything with input { token: string }. */
    buildStructural: () => JobTypes<{
      main: {
        entry: true;
        input: { id: string };
        output: { done: boolean };
        continueWith: undefined;
        blockers: readonly { input: { token: string } }[];
      };
      auth: {
        entry: true;
        input: { token: string };
        output: { userId: string };
        continueWith: undefined;
        blockers: undefined;
      };
    }>;
  };

  /**
   * Cross-slice external typing. Every adapter must thread the external
   * generic so multi-slice setups type correctly. The two-arg
   * `JobTypes<TInternal, TExternal>` return type makes this verifiable at the
   * call site.
   */
  external: {
    buildWithExternalSlice: () => JobTypes<
      {
        "orders.place-order": {
          entry: true;
          input: { userId: string };
          output: undefined;
          continueWith: { typeName: "orders.confirm-order" };
          blockers: undefined;
        };
        "orders.confirm-order": {
          entry: undefined;
          input: { orderId: number };
          output: { confirmedAt: string };
          continueWith: undefined;
          blockers: readonly [{ typeName: "notifications.send-notification" }];
        };
      },
      {
        "notifications.send-notification": {
          entry: true;
          input: { userId: string; message: string };
          output: { sentAt: string };
          continueWith: undefined;
          blockers: undefined;
        };
      }
    >;
    /**
     * Cross-slice external typing where the consuming slice references job
     * types from TWO external slices, passed as a `readonly` array. Adapters
     * that only thread a single-slice external (the 0.11 `mergeJobTypeRegistries`
     * regression) won't satisfy this return type.
     */
    buildWithExternalSlices: () => JobTypes<
      {
        "orders.place-order": {
          entry: true;
          input: { userId: string };
          output: undefined;
          continueWith: { typeName: "orders.confirm-order" };
          blockers: undefined;
        };
        "orders.confirm-order": {
          entry: undefined;
          input: { orderId: number };
          output: { confirmedAt: string };
          continueWith: undefined;
          blockers: readonly [
            { typeName: "notifications.send-notification" },
            { typeName: "payments.charge" },
          ];
        };
      },
      | {
          "notifications.send-notification": {
            entry: true;
            input: { userId: string; message: string };
            output: { sentAt: string };
            continueWith: undefined;
            blockers: undefined;
          };
        }
      | {
          "payments.charge": {
            entry: true;
            input: { amount: number };
            output: { receiptId: string };
            continueWith: undefined;
            blockers: undefined;
          };
        }
    >;
  };
};
