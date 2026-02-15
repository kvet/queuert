import { JobTypeValidationError } from "queuert";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createZodJobTypeRegistry } from "./zod-adapter.js";

describe("createZodJobTypeRegistry", () => {
  describe("validateEntry", () => {
    it("passes for entry types", () => {
      const registry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string() }) },
      });

      expect(() => {
        registry.validateEntry("main");
      }).not.toThrow();
    });

    it("throws for non-entry types", () => {
      const registry = createZodJobTypeRegistry({
        internal: { input: z.object({ id: z.string() }) },
      });

      expect(() => {
        registry.validateEntry("internal");
      }).toThrow(JobTypeValidationError);
    });

    it("throws for unknown types", () => {
      const registry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string() }) },
      });

      expect(() => {
        registry.validateEntry("unknown");
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("parseInput", () => {
    it("returns parsed input for valid data", () => {
      const registry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string(), count: z.number() }) },
      });

      const result = registry.parseInput("main", { id: "abc", count: 42 });
      expect(result).toEqual({ id: "abc", count: 42 });
    });

    it("throws for invalid input", () => {
      const registry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string() }) },
      });

      expect(() => {
        registry.parseInput("main", { id: 123 });
      }).toThrow(JobTypeValidationError);
    });

    it("coerces types when schema allows", () => {
      const registry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ count: z.coerce.number() }) },
      });

      const result = registry.parseInput("main", { count: "42" });
      expect(result).toEqual({ count: 42 });
    });
  });

  describe("parseOutput", () => {
    it("returns parsed output for valid data", () => {
      const registry = createZodJobTypeRegistry({
        main: {
          entry: true,
          input: z.object({ id: z.string() }),
          output: z.object({ success: z.boolean() }),
        },
      });

      const result = registry.parseOutput("main", { success: true });
      expect(result).toEqual({ success: true });
    });

    it("throws for invalid output", () => {
      const registry = createZodJobTypeRegistry({
        main: {
          entry: true,
          input: z.object({ id: z.string() }),
          output: z.object({ success: z.boolean() }),
        },
      });

      expect(() => {
        registry.parseOutput("main", { success: "yes" });
      }).toThrow(JobTypeValidationError);
    });

    it("throws when output schema is not defined", () => {
      const registry = createZodJobTypeRegistry({
        main: { entry: true, input: z.object({ id: z.string() }) },
      });

      expect(() => {
        registry.parseOutput("main", { success: true });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateContinueWith", () => {
    describe("nominal validation", () => {
      it("passes for valid type name", () => {
        const registry = createZodJobTypeRegistry({
          step1: {
            entry: true,
            input: z.object({ id: z.string() }),
            continueWith: z.object({ typeName: z.literal("step2") }),
          },
          step2: {
            input: z.object({ data: z.unknown() }),
            output: z.object({ done: z.boolean() }),
          },
        });

        expect(() => {
          registry.validateContinueWith("step1", {
            typeName: "step2",
            input: { data: "test" },
          });
        }).not.toThrow();
      });

      it("throws for invalid type name", () => {
        const registry = createZodJobTypeRegistry({
          step1: {
            entry: true,
            input: z.object({ id: z.string() }),
            continueWith: z.object({ typeName: z.literal("step2") }),
          },
          step2: { input: z.object({ data: z.unknown() }) },
        });

        expect(() => {
          registry.validateContinueWith("step1", { typeName: "step3", input: {} });
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching input shape", () => {
        const registry = createZodJobTypeRegistry({
          router: {
            entry: true,
            input: z.object({ route: z.string() }),
            continueWith: z.object({ input: z.object({ payload: z.string() }) }),
          },
          handler: {
            input: z.object({ payload: z.string() }),
            output: z.object({ handled: z.boolean() }),
          },
        });

        expect(() => {
          registry.validateContinueWith("router", {
            typeName: "handler",
            input: { payload: "test-data" },
          });
        }).not.toThrow();
      });

      it("throws for non-matching input shape", () => {
        const registry = createZodJobTypeRegistry({
          router: {
            entry: true,
            input: z.object({ route: z.string() }),
            continueWith: z.object({ input: z.object({ payload: z.string() }) }),
          },
          handler: { input: z.object({ wrongField: z.string() }) },
        });

        expect(() => {
          registry.validateContinueWith("router", {
            typeName: "handler",
            input: { wrongField: "test" },
          });
        }).toThrow(JobTypeValidationError);
      });
    });

    it("throws when continueWith is not defined", () => {
      const registry = createZodJobTypeRegistry({
        terminal: {
          entry: true,
          input: z.object({ id: z.string() }),
          output: z.object({ done: z.boolean() }),
        },
      });

      expect(() => {
        registry.validateContinueWith("terminal", { typeName: "next", input: {} });
      }).toThrow(JobTypeValidationError);
    });
  });

  describe("validateBlockers", () => {
    describe("nominal validation", () => {
      it("passes for valid blocker type names", () => {
        const registry = createZodJobTypeRegistry({
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
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "auth", input: { token: "abc" } }]);
        }).not.toThrow();
      });

      it("throws for invalid blocker type name", () => {
        const registry = createZodJobTypeRegistry({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            blockers: z.array(z.object({ typeName: z.literal("auth") })),
          },
          auth: { entry: true, input: z.object({ token: z.string() }) },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "wrong", input: {} }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    describe("structural validation", () => {
      it("passes for matching blocker input shapes", () => {
        const registry = createZodJobTypeRegistry({
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
          authOther: {
            entry: true,
            input: z.object({ token: z.string(), extra: z.string() }),
            output: z.object({ userId: z.string() }),
          },
        });

        // Both auth types have { token: string } in input, so both are valid
        expect(() => {
          registry.validateBlockers("main", [
            { typeName: "auth", input: { token: "abc" } },
            { typeName: "authOther", input: { token: "xyz", extra: "data" } },
          ]);
        }).not.toThrow();
      });

      it("throws for non-matching blocker input shape", () => {
        const registry = createZodJobTypeRegistry({
          main: {
            entry: true,
            input: z.object({ id: z.string() }),
            blockers: z.array(z.object({ input: z.object({ token: z.string() }) })),
          },
          config: {
            entry: true,
            input: z.object({ key: z.string() }),
          },
        });

        expect(() => {
          registry.validateBlockers("main", [{ typeName: "config", input: { key: "setting" } }]);
        }).toThrow(JobTypeValidationError);
      });
    });

    it("throws when blockers is not defined", () => {
      const registry = createZodJobTypeRegistry({
        main: {
          entry: true,
          input: z.object({ id: z.string() }),
          output: z.object({ done: z.boolean() }),
        },
      });

      expect(() => {
        registry.validateBlockers("main", [{ typeName: "auth", input: {} }]);
      }).toThrow(JobTypeValidationError);
    });
  });
});
