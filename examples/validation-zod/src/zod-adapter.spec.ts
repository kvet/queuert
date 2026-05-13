import { runValidationAdapterConformance } from "queuert/conformance";
import { test } from "vitest";
import { z } from "zod";

import { createZodJobTypes } from "./zod-adapter.js";

test("zod adapter passes validation conformance", async () => {
  await runValidationAdapterConformance(async () => ({
    basic: {
      buildEntry: () =>
        createZodJobTypes({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            output: z.object({ ok: z.boolean() }),
          },
        }),
      buildNonEntry: () =>
        createZodJobTypes({
          internal: {
            input: z.object({ id: z.string() }),
            output: z.object({ ok: z.boolean() }),
          },
        }),
      buildContinuationOnly: () =>
        createZodJobTypes({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            continueWith: z.object({ typeName: z.literal("next") }),
          },
          next: {
            input: z.object({ data: z.string() }),
            output: z.object({ done: z.boolean() }),
          },
        }),
    },
    continuations: {
      buildNominal: () =>
        createZodJobTypes({
          step1: {
            entry: true,
            input: z.object({ id: z.string() }),
            continueWith: z.object({ typeName: z.literal("step2") }),
          },
          step2: {
            input: z.object({ data: z.unknown() }),
            output: z.object({ done: z.boolean() }),
          },
        }),
      buildStructural: () =>
        createZodJobTypes({
          router: {
            entry: true,
            input: z.object({ route: z.string() }),
            continueWith: z.object({ input: z.object({ payload: z.string() }) }),
          },
          handler: {
            input: z.object({ payload: z.string() }),
            output: z.object({ handled: z.boolean() }),
          },
        }),
    },
    blockers: {
      buildNominal: () =>
        createZodJobTypes({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            output: z.object({ done: z.boolean() }),
            blockers: z.array(z.object({ typeName: z.literal("auth") })),
          },
          auth: {
            entry: true,
            input: z.object({ token: z.string() }),
            output: z.object({ userId: z.string() }),
          },
        }),
      buildStructural: () =>
        createZodJobTypes({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            output: z.object({ done: z.boolean() }),
            blockers: z.array(z.object({ input: z.object({ token: z.string() }) })),
          },
          auth: {
            entry: true,
            input: z.object({ token: z.string() }),
            output: z.object({ userId: z.string() }),
          },
        }),
    },
    external: {
      buildWithExternalSlice: () => {
        const notifications = createZodJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: z.object({ userId: z.string(), message: z.string() }),
            output: z.object({ sentAt: z.string() }),
          },
        });
        return createZodJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: z.object({ userId: z.string() }),
              continueWith: z.object({ typeName: z.literal("orders.confirm-order") }),
            },
            "orders.confirm-order": {
              input: z.object({ orderId: z.number() }),
              output: z.object({ confirmedAt: z.string() }),
              blockers: z.tuple([
                z.object({ typeName: z.literal("notifications.send-notification") }),
              ]),
            },
          },
          notifications,
        );
      },
      buildWithExternalSlices: () => {
        const notifications = createZodJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: z.object({ userId: z.string(), message: z.string() }),
            output: z.object({ sentAt: z.string() }),
          },
        });
        const payments = createZodJobTypes({
          "payments.charge": {
            entry: true,
            input: z.object({ amount: z.number() }),
            output: z.object({ receiptId: z.string() }),
          },
        });
        return createZodJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: z.object({ userId: z.string() }),
              continueWith: z.object({ typeName: z.literal("orders.confirm-order") }),
            },
            "orders.confirm-order": {
              input: z.object({ orderId: z.number() }),
              output: z.object({ confirmedAt: z.string() }),
              blockers: z.tuple([
                z.object({ typeName: z.literal("notifications.send-notification") }),
                z.object({ typeName: z.literal("payments.charge") }),
              ]),
            },
          },
          [notifications, payments] as const,
        );
      },
    },
  }));
});
