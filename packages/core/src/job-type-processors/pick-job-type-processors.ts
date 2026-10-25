import { type BaseJobTypeDefinitions } from "../job-types/job-type.js";
import { type JobTypeNames } from "../job-types/job-types.resolvers.js";
import {
  type ProcessorDefinitions,
  type ProcessorMiddlewareTuple,
  type Processors,
  processorsDefinitionsSymbol,
  processorsMiddlewareSymbol,
} from "./job-type-processors.js";

const selectProcessors = (
  functionName: string,
  processors: Processors,
  typeNames: readonly string[],
  keep: (typeName: string) => boolean,
): Processors => {
  if (typeNames.length === 0) {
    throw new Error(`${functionName}: at least one job type name is required`);
  }
  const unknownTypeNames = typeNames.filter((typeName) => !Object.hasOwn(processors, typeName));
  if (unknownTypeNames.length > 0) {
    throw new Error(
      `${functionName}: processors do not include job types: ${unknownTypeNames.join(", ")}`,
    );
  }
  const selected = Object.fromEntries(
    Object.entries(processors).filter(([typeName]) => keep(typeName)),
  );
  if (Object.keys(selected).length === 0) {
    throw new Error(`${functionName}: selection leaves no processors`);
  }
  return Object.assign(selected, {
    [processorsDefinitionsSymbol]: processors[processorsDefinitionsSymbol],
    [processorsMiddlewareSymbol]: processors[processorsMiddlewareSymbol],
  });
};

/**
 * Create a registry holding only the listed job types of `processors`, e.g. to run them on a
 * dedicated worker. Each picked processor keeps its handler, its middleware chain and its
 * `backoffConfig` / `attemptConfig`.
 *
 * @example
 * const imageWorker = createInProcessWorker({
 *   client,
 *   processors: pickProcessors(appProcessors, ["images.resize", "images.transcode"]),
 * });
 *
 * @throws {Error} if the list is empty, or a listed job type has no processor in `processors`.
 */
export const pickProcessors = <
  TProcessors extends Processors,
  const TTypeNames extends readonly [
    JobTypeNames<ProcessorDefinitions<TProcessors>>,
    ...JobTypeNames<ProcessorDefinitions<TProcessors>>[],
  ],
>(
  processors: TProcessors,
  typeNames: TTypeNames,
): Pick<
  ProcessorDefinitions<TProcessors>,
  TTypeNames[number]
> extends infer TPickedDefinitions extends BaseJobTypeDefinitions
  ? Processors<TPickedDefinitions, ProcessorMiddlewareTuple<TProcessors>>
  : never =>
  selectProcessors("pickProcessors", processors, typeNames, (typeName) =>
    (typeNames as readonly string[]).includes(typeName),
  ) as never;

/**
 * Create a registry holding every job type of `processors` except the listed ones, e.g. for the
 * worker that handles whatever the dedicated workers built with {@link pickProcessors} don't.
 * Each remaining processor keeps its handler, its middleware chain and its
 * `backoffConfig` / `attemptConfig`.
 *
 * @example
 * const defaultWorker = createInProcessWorker({
 *   client,
 *   processors: omitProcessors(appProcessors, ["images.resize", "images.transcode"]),
 * });
 *
 * @throws {Error} if the list is empty, a listed job type has no processor in `processors`, or
 * every processor is omitted.
 */
export const omitProcessors = <
  TProcessors extends Processors,
  const TTypeNames extends readonly [
    JobTypeNames<ProcessorDefinitions<TProcessors>>,
    ...JobTypeNames<ProcessorDefinitions<TProcessors>>[],
  ],
>(
  processors: TProcessors,
  typeNames: TTypeNames &
    ([Exclude<JobTypeNames<ProcessorDefinitions<TProcessors>>, TTypeNames[number]>] extends [never]
      ? "Error: omitProcessors would omit every processor"
      : unknown),
): Omit<
  ProcessorDefinitions<TProcessors>,
  TTypeNames[number]
> extends infer TRemainingDefinitions extends BaseJobTypeDefinitions
  ? Processors<TRemainingDefinitions, ProcessorMiddlewareTuple<TProcessors>>
  : never =>
  selectProcessors(
    "omitProcessors",
    processors,
    typeNames,
    (typeName) => !(typeNames as readonly string[]).includes(typeName),
  ) as never;
