import { type } from "arktype";
import { runValidationAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createArkTypeJobTypes } from "./arktype-adapter.js";

test("arktype adapter passes validation conformance", async () => {
  await runValidationAdapterConformance(async () => ({
    basic: {
      buildEntry: () =>
        createArkTypeJobTypes({
          main: {
            entry: true,
            input: type({ id: "string" }),
            output: type({ ok: "boolean" }),
          },
        }),
      buildNonEntry: () =>
        createArkTypeJobTypes({
          internal: {
            input: type({ id: "string" }),
            output: type({ ok: "boolean" }),
          },
        }),
      buildContinuationOnly: () =>
        createArkTypeJobTypes({
          main: {
            entry: true,
            input: type({ id: "string" }),
            continueWith: type({ typeName: "'next'" }),
          },
          next: {
            input: type({ data: "string" }),
            output: type({ done: "boolean" }),
          },
        }),
    },
    continuations: {
      buildNominal: () =>
        createArkTypeJobTypes({
          step1: {
            entry: true,
            input: type({ id: "string" }),
            continueWith: type({ typeName: "'step2'" }),
          },
          step2: {
            input: type({ data: "unknown" }),
            output: type({ done: "boolean" }),
          },
        }),
      buildStructural: () =>
        createArkTypeJobTypes({
          router: {
            entry: true,
            input: type({ route: "string" }),
            continueWith: type({ input: { payload: "string" } }),
          },
          handler: {
            input: type({ payload: "string" }),
            output: type({ handled: "boolean" }),
          },
        }),
    },
    blockers: {
      buildNominal: () =>
        createArkTypeJobTypes({
          main: {
            entry: true,
            input: type({ id: "string" }),
            output: type({ done: "boolean" }),
            blockers: type({ typeName: "'auth'" }).array(),
          },
          auth: {
            entry: true,
            input: type({ token: "string" }),
            output: type({ userId: "string" }),
          },
        }),
      buildStructural: () =>
        createArkTypeJobTypes({
          main: {
            entry: true,
            input: type({ id: "string" }),
            output: type({ done: "boolean" }),
            blockers: type({ input: { token: "string" } }).array(),
          },
          auth: {
            entry: true,
            input: type({ token: "string" }),
            output: type({ userId: "string" }),
          },
        }),
    },
    external: {
      buildWithExternalSlice: () => {
        const notifications = createArkTypeJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: type({ userId: "string", message: "string" }),
            output: type({ sentAt: "string" }),
          },
        });
        return createArkTypeJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: type({ userId: "string" }),
              continueWith: type({ typeName: "'orders.confirm-order'" }),
            },
            "orders.confirm-order": {
              input: type({ orderId: "number" }),
              output: type({ confirmedAt: "string" }),
              blockers: type([{ typeName: "'notifications.send-notification'" }]),
            },
          },
          notifications,
        );
      },
      buildWithExternalSlices: () => {
        const notifications = createArkTypeJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: type({ userId: "string", message: "string" }),
            output: type({ sentAt: "string" }),
          },
        });
        const payments = createArkTypeJobTypes({
          "payments.charge": {
            entry: true,
            input: type({ amount: "number" }),
            output: type({ receiptId: "string" }),
          },
        });
        return createArkTypeJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: type({ userId: "string" }),
              continueWith: type({ typeName: "'orders.confirm-order'" }),
            },
            "orders.confirm-order": {
              input: type({ orderId: "number" }),
              output: type({ confirmedAt: "string" }),
              blockers: type([
                { typeName: "'notifications.send-notification'" },
                { typeName: "'payments.charge'" },
              ]),
            },
          },
          [notifications, payments] as const,
        );
      },
    },
  }));
});
