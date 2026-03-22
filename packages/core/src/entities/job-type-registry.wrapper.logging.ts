import { JobTypeValidationError } from "../errors.js";
import { type ObservabilityHelper } from "../observability-adapter/observability-helper.js";
import {
  type JobTypeRegistry,
  definitionsSymbol,
  externalDefinitionsSymbol,
  mergedRegistrySymbol,
} from "./job-type-registry.js";

export const wrapJobTypeRegistryWithLogging = <TJobTypeDefinitions>({
  jobTypeRegistry,
  observabilityHelper,
}: {
  jobTypeRegistry: JobTypeRegistry<TJobTypeDefinitions>;
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
    getTypeNames: () => jobTypeRegistry.getTypeNames(),
    validateEntry: wrap(jobTypeRegistry.validateEntry),
    parseInput: wrap(jobTypeRegistry.parseInput),
    parseOutput: wrap(jobTypeRegistry.parseOutput),
    validateContinueWith: wrap(jobTypeRegistry.validateContinueWith),
    validateBlockers: wrap(jobTypeRegistry.validateBlockers),
    [definitionsSymbol]: jobTypeRegistry[definitionsSymbol],
    [externalDefinitionsSymbol]: jobTypeRegistry[externalDefinitionsSymbol],
    [mergedRegistrySymbol]: jobTypeRegistry[mergedRegistrySymbol],
  };
};
