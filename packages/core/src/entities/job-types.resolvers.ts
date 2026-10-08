/**
 * Type-level resolution for job type definitions.
 *
 * All types operate directly on `BaseJobTypeDefinitions` — the user's raw type definitions.
 * For merged registries, definitions are a union (`DefsA | DefsB`); TypeScript's
 * distributive conditional types automatically distribute operations over each slice.
 *
 * Foundation accessors:
 * - `JobTypeProperty<TJobTypeDefinitions, K, P>` — look up a definition property
 * - `JobTypeNames<TJobTypeDefinitions>` — all type names
 *
 * Computed cross-type resolution:
 * - `JobTypeContinuation<TJobTypeDefinitions, K>` — resolves continueWith references to type name strings
 * - `JobTypeReachingEntry<TJobTypeDefinitions, K>` — which entry types can reach K via chain walking
 */

import {
  type Chain,
  type ChainFields,
  type CompletedChainFields,
  type RunningChainFields,
} from "./chain.types.js";
import {
  type BaseJobTypeDefinitions,
  type JobTypeReference,
  type NominalJobTypeReference,
  type StructuralJobTypeReference,
} from "./job-type.js";
import {
  type CompletedJobFields,
  type ContinuedJobFields,
  type Job,
  type JobFields,
  type PendingJobFields,
  type RunningJobFields,
  type TerminalJobFields,
} from "./job.js";

// ─── Distributive accessors ───

/**
 * Distributive property access on job type definitions.
 * For unions (`DefsA | DefsB`), distributes to the slice containing key K.
 */
export type JobTypeProperty<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  K extends string,
  P extends string,
> = TJobTypeDefinitions extends any
  ? K extends keyof TJobTypeDefinitions
    ? P extends keyof TJobTypeDefinitions[K]
      ? TJobTypeDefinitions[K][P]
      : never
    : never
  : never;

/** Distributive keyof — returns all type names across all slices. */
export type JobTypeNames<TJobTypeDefinitions extends BaseJobTypeDefinitions> =
  TJobTypeDefinitions extends any ? keyof TJobTypeDefinitions & string : never;

/** Distributive key filter — returns type names where property P extends value V. */
type FilterByProperty<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  P extends string,
  V,
> = TJobTypeDefinitions extends any
  ? {
      [K in keyof TJobTypeDefinitions & string]: P extends keyof TJobTypeDefinitions[K]
        ? TJobTypeDefinitions[K][P] extends V
          ? K
          : never
        : never;
    }[keyof TJobTypeDefinitions & string]
  : never;

// ─── Computed cross-type resolution ───

type MatchingByInput<TJobTypeDefinitions extends BaseJobTypeDefinitions, TInput> = {
  [K in keyof TJobTypeDefinitions]: TJobTypeDefinitions[K] extends { input: infer I }
    ? [TInput] extends [I]
      ? K
      : never
    : never;
}[keyof TJobTypeDefinitions] &
  string;

/** Non-distributive reference resolution — used inside already-distributed contexts. */
type ResolveReference<TJobTypeDefinitions extends BaseJobTypeDefinitions, TRef> =
  TRef extends NominalJobTypeReference<infer TN>
    ? TN & keyof TJobTypeDefinitions
    : TRef extends StructuralJobTypeReference<infer TI>
      ? MatchingByInput<TJobTypeDefinitions, TI>
      : never;

/** Distributive reference resolution — for cross-slice blocker resolution on union definitions. */
type ResolveReferenceDistributive<TJobTypeDefinitions extends BaseJobTypeDefinitions, TRef> =
  TRef extends NominalJobTypeReference<infer TN>
    ? TN & JobTypeNames<TJobTypeDefinitions>
    : TRef extends StructuralJobTypeReference<infer TI>
      ? TJobTypeDefinitions extends any
        ? MatchingByInput<TJobTypeDefinitions, TI>
        : never
      : never;

/**
 * Resolves `continueWith` references to concrete type name strings.
 * Distributive — for unions, resolves within the slice containing K.
 */
export type JobTypeContinuation<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  K extends string,
> = TJobTypeDefinitions extends any
  ? K extends keyof TJobTypeDefinitions
    ? TJobTypeDefinitions[K] extends { continueWith: infer CT }
      ? ResolveReference<TJobTypeDefinitions, CT> & string
      : never
    : never
  : never;

type ChainWalk<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  K extends string,
  Visited extends string = never,
> = [K] extends [never]
  ? Visited
  : K extends Visited
    ? Visited
    : ChainWalk<TJobTypeDefinitions, JobTypeContinuation<TJobTypeDefinitions, K>, Visited | K>;

type EntryKeys<TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [K in keyof TJobTypeDefinitions & string]: TJobTypeDefinitions[K] extends { entry: true }
    ? K
    : never;
}[keyof TJobTypeDefinitions & string];

/** Entry type names whose chain walk reaches K — distributes over the slice's entry names. */
type ChainReachingEntries<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  K extends string,
  TEntryName = EntryKeys<TJobTypeDefinitions>,
> = TEntryName extends string
  ? K extends ChainWalk<TJobTypeDefinitions, TEntryName>
    ? TEntryName
    : never
  : never;

/**
 * Which entry types can reach K via chain walking.
 * Distributive — for unions, computes within the slice containing K.
 */
export type JobTypeReachingEntry<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  K extends string,
> = TJobTypeDefinitions extends any
  ? K extends keyof TJobTypeDefinitions
    ? // An `any` name stays `any`, keeping `Client` assignable across merged slices.
      0 extends 1 & K
      ? any
      : ChainReachingEntries<TJobTypeDefinitions, K>
    : never
  : never;

/**
 * All type names reachable from K by following continuation links.
 * Distributive — for unions, walks within the slice containing K.
 */
export type JobTypeChainNames<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  K extends string,
> = ChainWalk<TJobTypeDefinitions, K> & string;

// ─── Entry types ───

/** Entry type definitions — filters to job types with `entry: true`. */
export type JobTypeEntryDefinitions<TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [
    K in keyof TJobTypeDefinitions as TJobTypeDefinitions[K] extends { entry: true } ? K : never
  ]: TJobTypeDefinitions[K];
};

/** Entry type names — distributive, works on merged (union) definitions. */
export type JobTypeEntryNames<TJobTypeDefinitions extends BaseJobTypeDefinitions> =
  FilterByProperty<TJobTypeDefinitions, "entry", true>;

// ─── Job resolution ───

export type JobTypeHasBlockers<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "blockers"> extends infer B
    ? [B] extends [never]
      ? false
      : B extends readonly []
        ? false
        : B extends readonly unknown[]
          ? true
          : false
    : false;

/** Resolves a {@link Job} with concrete input/output types for a given job type name. */
export type ResolvedJob<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
> = Job<
  TJobId,
  TJobTypeName,
  TChainTypeName,
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "input">,
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output">,
  [JobTypeContinuation<TJobTypeDefinitions, TJobTypeName>] extends [never] ? false : true
>;

/** The `running` `ResolvedJob` — the job an attempt handler receives. */
export type ResolvedRunningJob<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
> = ResolvedJobFields<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName> & RunningJobFields;

/** {@link JobFields} resolved from the definitions for a given job type name. */
type ResolvedJobFields<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string,
> = JobFields<
  TJobId,
  TJobTypeName,
  TChainTypeName,
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "input">
>;

// The single-variant resolvers below assemble the variant from its named parts
// rather than `Extract`-ing it from `ResolvedJob`: same shape, but the checker
// skips normalizing and filtering the whole status union per job type.

export type ContinuationJob<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TContinuationTypeName extends string,
  TChainTypeName extends string,
> = ResolvedJobFields<TJobId, TJobTypeDefinitions, TContinuationTypeName, TChainTypeName> &
  PendingJobFields;

export type ContinuationJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
> =
  JobTypeContinuation<TJobTypeDefinitions, TJobTypeName> extends infer TContinuation extends string
    ? ContinuationJob<TJobId, TJobTypeDefinitions, TContinuation, TChainTypeName>
    : never;

export type OutputJob<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
> =
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "output"> extends infer TOutput
    ? [TOutput] extends [never]
      ? never
      : ResolvedJobFields<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName> &
          CompletedJobFields &
          TerminalJobFields<TOutput> & { continuedTo: undefined }
    : never;

export type RescheduledJob<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
> = ResolvedJobFields<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName> & PendingJobFields;

export type ContinuedJob<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
  TContinuationTypeName extends string = string,
> = [JobTypeContinuation<TJobTypeDefinitions, TJobTypeName>] extends [never]
  ? never
  : ResolvedJobFields<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName> &
      CompletedJobFields &
      ContinuedJobFields<TJobId> & {
        continuedTo: ContinuationJob<
          TJobId,
          TJobTypeDefinitions,
          TContinuationTypeName,
          TChainTypeName
        >;
      };

/** Output of a chain started at the given entry type: the union of outputs reachable along it. */
type ResolvedChainOutput<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> = Exclude<
  JobTypeProperty<
    TJobTypeDefinitions,
    JobTypeChainNames<TJobTypeDefinitions, TJobTypeName>,
    "output"
  >,
  undefined
>;

/**
 * Resolves a {@link Chain} with concrete input/output types for a given entry type name.
 * Distributes over a union of entry type names: the chain's `input` is its entry
 * type's input, its `output` the union of outputs reachable along the chain.
 */
export type ResolvedChain<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> = TJobTypeName extends any
  ? Chain<
      TJobId,
      TJobTypeName,
      JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "input">,
      ResolvedChainOutput<TJobTypeDefinitions, TJobTypeName>
    >
  : never;

/** The `completed` variant of `ResolvedChain`, assembled directly rather than `Extract`-ed. */
export type ResolvedCompletedChain<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> = TJobTypeName extends any
  ? ChainFields<TJobId, TJobTypeName, JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "input">> &
      CompletedChainFields<ResolvedChainOutput<TJobTypeDefinitions, TJobTypeName>>
  : never;

/** The `running` variant of `ResolvedChain`, assembled directly rather than `Extract`-ed. */
export type ResolvedRunningChain<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> = TJobTypeName extends any
  ? ChainFields<TJobId, TJobTypeName, JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "input">> &
      RunningChainFields
  : never;

/** Union of all resolved {@link Job} types reachable within a chain starting from the given entry type. */
export type ResolvedChainJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TChainTypeName extends string,
> =
  JobTypeChainNames<TJobTypeDefinitions, TChainTypeName> extends infer TChainTypeNames extends
    string
    ? {
        [K in TChainTypeNames]: Job<
          TJobId,
          K,
          TChainTypeName,
          JobTypeProperty<TJobTypeDefinitions, K, "input">,
          JobTypeProperty<TJobTypeDefinitions, K, "output">,
          [JobTypeContinuation<TJobTypeDefinitions, K>] extends [never] ? false : true
        >;
      }[TChainTypeNames]
    : never;

// ─── Blocker types ───

type MapBlockersToChains<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockers extends readonly unknown[],
> = {
  [K in keyof TBlockers]: TBlockers[K] extends JobTypeReference
    ? ResolvedChain<
        TJobId,
        TJobTypeDefinitions,
        ResolveReferenceDistributive<TJobTypeDefinitions, TBlockers[K]> & string
      >
    : never;
};

/** Resolves the blocker chains tuple for a job type, mapping each blocker reference to its resolved {@link Chain} type. */
export type BlockerChains<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "blockers"> extends infer TBlockers
    ? [TBlockers] extends [never]
      ? []
      : TBlockers extends readonly unknown[]
        ? MapBlockersToChains<TJobId, TJobTypeDefinitions, TBlockers>
        : []
    : [];

type BlockerRefNames<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TDefEntry,
> = TDefEntry extends {
  blockers: readonly (infer TRef)[];
}
  ? ResolveReferenceDistributive<TJobTypeDefinitions, TRef>
  : never;

export type JobTypeBlockedNames<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockerChainTypeName extends string,
> = TJobTypeDefinitions extends any
  ? {
      [K in keyof TJobTypeDefinitions & string]: TBlockerChainTypeName extends BlockerRefNames<
        TJobTypeDefinitions,
        TJobTypeDefinitions[K]
      >
        ? K
        : never;
    }[keyof TJobTypeDefinitions & string]
  : never;

type MapBlockersToCompletedChains<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TBlockers extends readonly unknown[],
> = {
  [K in keyof TBlockers]: TBlockers[K] extends JobTypeReference
    ? ResolvedCompletedChain<
        TJobId,
        TJobTypeDefinitions,
        ResolveReferenceDistributive<TJobTypeDefinitions, TBlockers[K]> & string
      >
    : never;
};

/** {@link BlockerChains} with every chain narrowed to its `completed` variant — what a running job sees. */
export type CompletedBlockerChains<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  JobTypeProperty<TJobTypeDefinitions, TJobTypeName, "blockers"> extends infer TBlockers
    ? [TBlockers] extends [never]
      ? []
      : TBlockers extends readonly unknown[]
        ? MapBlockersToCompletedChains<TJobId, TJobTypeDefinitions, TBlockers>
        : []
    : [];
