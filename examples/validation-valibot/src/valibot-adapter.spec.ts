import { runValidationAdapterConformance } from "queuert/conformance";
import * as v from "valibot";
import { test } from "vitest";

import { createValibotJobTypes } from "./valibot-adapter.js";

test("valibot adapter passes validation conformance", async () => {
  await runValidationAdapterConformance(async () => ({
    basic: {
      buildEntry: () =>
        createValibotJobTypes({
          main: {
            entry: true,
            input: v.object({ id: v.string() }),
            output: v.object({ ok: v.boolean() }),
          },
        }),
      buildNonEntry: () =>
        createValibotJobTypes({
          internal: {
            input: v.object({ id: v.string() }),
            output: v.object({ ok: v.boolean() }),
          },
        }),
      buildContinuationOnly: () =>
        createValibotJobTypes({
          main: {
            entry: true,
            input: v.object({ id: v.string() }),
            continueWith: v.object({ typeName: v.literal("next") }),
          },
          next: {
            input: v.object({ data: v.string() }),
            output: v.object({ done: v.boolean() }),
          },
        }),
    },
    continuations: {
      buildNominal: () =>
        createValibotJobTypes({
          step1: {
            entry: true,
            input: v.object({ id: v.string() }),
            continueWith: v.object({ typeName: v.literal("step2") }),
          },
          step2: {
            input: v.object({ data: v.unknown() }),
            output: v.object({ done: v.boolean() }),
          },
        }),
      buildStructural: () =>
        createValibotJobTypes({
          router: {
            entry: true,
            input: v.object({ route: v.string() }),
            continueWith: v.object({ input: v.object({ payload: v.string() }) }),
          },
          handler: {
            input: v.object({ payload: v.string() }),
            output: v.object({ handled: v.boolean() }),
          },
        }),
    },
    blockers: {
      buildNominal: () =>
        createValibotJobTypes({
          main: {
            entry: true,
            input: v.object({ id: v.string() }),
            output: v.object({ done: v.boolean() }),
            blockers: v.array(v.object({ typeName: v.literal("auth") })),
          },
          auth: {
            entry: true,
            input: v.object({ token: v.string() }),
            output: v.object({ userId: v.string() }),
          },
        }),
      buildStructural: () =>
        createValibotJobTypes({
          main: {
            entry: true,
            input: v.object({ id: v.string() }),
            output: v.object({ done: v.boolean() }),
            blockers: v.array(v.object({ input: v.object({ token: v.string() }) })),
          },
          auth: {
            entry: true,
            input: v.object({ token: v.string() }),
            output: v.object({ userId: v.string() }),
          },
        }),
    },
    external: {
      buildWithExternalSlice: () => {
        const notifications = createValibotJobTypes({
          "notifications.send-notification": {
            entry: true,
            input: v.object({ userId: v.string(), message: v.string() }),
            output: v.object({ sentAt: v.string() }),
          },
        });
        return createValibotJobTypes(
          {
            "orders.place-order": {
              entry: true,
              input: v.object({ userId: v.string() }),
              continueWith: v.object({ typeName: v.literal("orders.confirm-order") }),
            },
            "orders.confirm-order": {
              input: v.object({ orderId: v.number() }),
              output: v.object({ confirmedAt: v.string() }),
              blockers: v.array(
                v.object({ typeName: v.literal("notifications.send-notification") }),
              ),
            },
          },
          notifications,
        );
      },
    },
  }));
});
