import { describe, expect, expectTypeOf, it } from "vitest";
import { DuplicateJobTypeError } from "../errors.js";
import {
  type InProcessWorkerProcessors,
  type JobTypeRegistryDefinitions,
  type StateAdapter,
} from "../index.js";
import { defineJobTypes } from "../entities/job-type.js";
import { mergeJobTypeProcessors } from "./merge-job-type-processors.js";

type OrderDefs = {
  "orders.create": { entry: true; input: { userId: string }; output: { orderId: string } };
  "orders.fulfill": { input: { orderId: string }; output: { fulfilled: boolean } };
};

type NotificationDefs = {
  "notifications.send": { entry: true; input: { to: string }; output: { sent: boolean } };
};

const orderJobTypes = defineJobTypes<OrderDefs>();
const notificationJobTypes = defineJobTypes<NotificationDefs>();

const orderProcessors = {
  "orders.create": {
    attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "1" })),
  },
  "orders.fulfill": {
    attemptHandler: async ({ complete }) => complete(async () => ({ fulfilled: true })),
  },
} satisfies InProcessWorkerProcessors<
  StateAdapter<any, any>,
  JobTypeRegistryDefinitions<typeof orderJobTypes>
>;

const notificationProcessors = {
  "notifications.send": {
    attemptHandler: async ({ complete }) => complete(async () => ({ sent: true })),
  },
} satisfies InProcessWorkerProcessors<
  StateAdapter<any, any>,
  JobTypeRegistryDefinitions<typeof notificationJobTypes>
>;

describe("mergeJobTypeProcessors", () => {
  it("merges two processor slices into a single object", () => {
    const merged = mergeJobTypeProcessors(orderProcessors, notificationProcessors);

    expect(merged).toHaveProperty("orders.create");
    expect(merged).toHaveProperty("orders.fulfill");
    expect(merged).toHaveProperty("notifications.send");
  });

  it("merges three processor slices", () => {
    const billingJobTypes = defineJobTypes<{
      "billing.charge": { entry: true; input: { amount: number }; output: { charged: boolean } };
    }>();

    const billingProcessors = {
      "billing.charge": {
        attemptHandler: async ({ complete }) => complete(async () => ({ charged: true })),
      },
    } satisfies InProcessWorkerProcessors<
      StateAdapter<any, any>,
      JobTypeRegistryDefinitions<typeof billingJobTypes>
    >;

    const merged = mergeJobTypeProcessors(
      orderProcessors,
      notificationProcessors,
      billingProcessors,
    );

    expect(merged).toHaveProperty("orders.create");
    expect(merged).toHaveProperty("notifications.send");
    expect(merged).toHaveProperty("billing.charge");
  });

  it("preserves handler references", () => {
    const merged = mergeJobTypeProcessors(orderProcessors, notificationProcessors);

    expect(merged["orders.create"]).toBe(orderProcessors["orders.create"]);
    expect(merged["notifications.send"]).toBe(notificationProcessors["notifications.send"]);
  });

  it("merged result carries the specific processor keys from each slice", () => {
    const merged = mergeJobTypeProcessors(orderProcessors, notificationProcessors);

    expectTypeOf(merged).toHaveProperty("orders.create");
    expectTypeOf(merged).toHaveProperty("orders.fulfill");
    expectTypeOf(merged).toHaveProperty("notifications.send");
  });

  it("throws DuplicateJobTypeError for duplicate keys at runtime", () => {
    const altOrderProcessors = {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
      },
    } satisfies InProcessWorkerProcessors<
      StateAdapter<any, any>,
      JobTypeRegistryDefinitions<typeof orderJobTypes>
    >;

    expect(() => {
      // @ts-expect-error — duplicate "orders.create" detected at compile time
      mergeJobTypeProcessors(orderProcessors, altOrderProcessors);
    }).toThrow(DuplicateJobTypeError);
  });

  it("includes duplicate keys in the error", () => {
    expect.assertions(2);

    const altOrderProcessors = {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "alt" })),
      },
    } satisfies InProcessWorkerProcessors<
      StateAdapter<any, any>,
      JobTypeRegistryDefinitions<typeof orderJobTypes>
    >;

    try {
      // @ts-expect-error — duplicate "orders.create"
      mergeJobTypeProcessors(orderProcessors, altOrderProcessors);
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateJobTypeError);
      expect((error as DuplicateJobTypeError).duplicateTypeNames).toEqual(["orders.create"]);
    }
  });

  it("detects duplicate processor keys at compile time", () => {
    const duplicateProcessors = {
      "orders.create": {
        attemptHandler: async ({ complete }) => complete(async () => ({ orderId: "dup" })),
      },
    } satisfies InProcessWorkerProcessors<
      StateAdapter<any, any>,
      JobTypeRegistryDefinitions<typeof orderJobTypes>
    >;

    expect(() => {
      // @ts-expect-error — "orders.create" appears in both slices
      mergeJobTypeProcessors(orderProcessors, duplicateProcessors);
    }).toThrow(DuplicateJobTypeError);
  });

  it("detects duplicates across three slices at compile time", () => {
    const conflictProcessors = {
      "orders.fulfill": {
        attemptHandler: async ({ complete }) => complete(async () => ({ fulfilled: false })),
      },
    } satisfies InProcessWorkerProcessors<
      StateAdapter<any, any>,
      JobTypeRegistryDefinitions<typeof orderJobTypes>
    >;

    expect(() => {
      // @ts-expect-error — "orders.fulfill" duplicated between first and third slice
      mergeJobTypeProcessors(orderProcessors, notificationProcessors, conflictProcessors);
    }).toThrow(DuplicateJobTypeError);
  });
});
