import { Type } from "@sinclair/typebox";
import { runValidationAdapterConformance } from "queuert/conformance";
import { test } from "vitest";

import { createTypeBoxJobTypes } from "./typebox-adapter.js";

test("typebox adapter passes validation conformance", async () => {
  await runValidationAdapterConformance(async () => ({
    basic: {
      buildEntry: () =>
        createTypeBoxJobTypes({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            output: Type.Object({ ok: Type.Boolean() }),
          },
        }),
      buildNonEntry: () =>
        createTypeBoxJobTypes({
          internal: {
            input: Type.Object({ id: Type.String() }),
            output: Type.Object({ ok: Type.Boolean() }),
          },
        }),
      buildContinuationOnly: () =>
        createTypeBoxJobTypes({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            continueWith: Type.Object({ typeName: Type.Literal("next") }),
          },
          next: {
            input: Type.Object({ data: Type.String() }),
            output: Type.Object({ done: Type.Boolean() }),
          },
        }),
    },
    continuations: {
      buildNominal: () =>
        createTypeBoxJobTypes({
          step1: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            continueWith: Type.Object({ typeName: Type.Literal("step2") }),
          },
          step2: {
            input: Type.Object({ data: Type.Unknown() }),
            output: Type.Object({ done: Type.Boolean() }),
          },
        }),
      buildStructural: () =>
        createTypeBoxJobTypes({
          router: {
            entry: true,
            input: Type.Object({ route: Type.String() }),
            continueWith: Type.Object({ input: Type.Object({ payload: Type.String() }) }),
          },
          handler: {
            input: Type.Object({ payload: Type.String() }),
            output: Type.Object({ handled: Type.Boolean() }),
          },
        }),
    },
    blockers: {
      buildNominal: () =>
        createTypeBoxJobTypes({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            output: Type.Object({ done: Type.Boolean() }),
            blockers: Type.Array(Type.Object({ typeName: Type.Literal("auth") })),
          },
          auth: {
            entry: true,
            input: Type.Object({ token: Type.String() }),
            output: Type.Object({ userId: Type.String() }),
          },
        }),
      buildStructural: () =>
        createTypeBoxJobTypes({
          main: {
            entry: true,
            input: Type.Object({ id: Type.String() }),
            output: Type.Object({ done: Type.Boolean() }),
            blockers: Type.Array(Type.Object({ input: Type.Object({ token: Type.String() }) })),
          },
          auth: {
            entry: true,
            input: Type.Object({ token: Type.String() }),
            output: Type.Object({ userId: Type.String() }),
          },
        }),
    },
    external: {
      buildWithExternalSlice: () => {
        const notifications = createTypeBoxJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: Type.Object({ userId: Type.String(), message: Type.String() }),
            output: Type.Object({ sentAt: Type.String() }),
          },
        });
        return createTypeBoxJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: Type.Object({ userId: Type.String() }),
              continueWith: Type.Object({ typeName: Type.Literal("orders.confirm-order") }),
            },
            "orders.confirm-order": {
              input: Type.Object({ orderId: Type.Number() }),
              output: Type.Object({ confirmedAt: Type.String() }),
              blockers: Type.Tuple([
                Type.Object({ typeName: Type.Literal("notifications.send-notification") }),
              ]),
            },
          },
          notifications,
        );
      },
      buildWithExternalSlices: () => {
        const notifications = createTypeBoxJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: Type.Object({ userId: Type.String(), message: Type.String() }),
            output: Type.Object({ sentAt: Type.String() }),
          },
        });
        const payments = createTypeBoxJobTypes({
          "payments.charge": {
            entry: true,
            input: Type.Object({ amount: Type.Number() }),
            output: Type.Object({ receiptId: Type.String() }),
          },
        });
        return createTypeBoxJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: Type.Object({ userId: Type.String() }),
              continueWith: Type.Object({ typeName: Type.Literal("orders.confirm-order") }),
            },
            "orders.confirm-order": {
              input: Type.Object({ orderId: Type.Number() }),
              output: Type.Object({ confirmedAt: Type.String() }),
              blockers: Type.Tuple([
                Type.Object({ typeName: Type.Literal("notifications.send-notification") }),
                Type.Object({ typeName: Type.Literal("payments.charge") }),
              ]),
            },
          },
          [notifications, payments] as const,
        );
      },
    },
  }));
});
