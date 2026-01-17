import { ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import { JobTypeValidationError } from "../queuert-helper.js";
import { JobTypeRegistry } from "./job-type-registry.js";

export const wrapJobTypeRegistryWithLogging = <TJobTypeDefinitions>({
  registry,
  observabilityHelper,
}: {
  registry: JobTypeRegistry<TJobTypeDefinitions>;
  observabilityHelper: ObservabilityHelper;
}): JobTypeRegistry<TJobTypeDefinitions> => {
  const wrap = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args) => {
      try {
        return fn(...args);
      } catch (error) {
        if (error instanceof JobTypeValidationError) {
          observabilityHelper.jobTypeValidationError(error);
        }
        throw error;
      }
    }) as T;

  return {
    validateEntry: wrap(registry.validateEntry),
    parseInput: wrap(registry.parseInput),
    parseOutput: wrap(registry.parseOutput),
    validateContinueWith: wrap(registry.validateContinueWith),
    validateBlockers: wrap(registry.validateBlockers),
    $definitions: registry.$definitions,
  };
};
