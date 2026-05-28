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

import { type Chain, type CompletedChain } from "./chain.types.js";
import {
  type BaseJobTypeDefinitions,
  type JobTypeReference,
  type NominalJobTypeReference,
  type StructuralJobTypeReference,
} from "./job-type.js";
import { type Job } from "./job.js";

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

type ChainReachMap<TJobTypeDefinitions extends BaseJobTypeDefinitions> = {
  [TypeName in keyof TJobTypeDefinitions]: {
    [E in EntryKeys<TJobTypeDefinitions>]: TypeName extends ChainWalk<TJobTypeDefinitions, E>
      ? E
      : never;
  }[EntryKeys<TJobTypeDefinitions>];
};

/**
 * Which entry types can reach K via chain walking.
 * Distributive — for unions, computes within the slice containing K.
 */
export type JobTypeReachingEntry<
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  K extends string,
> = TJobTypeDefinitions extends any
  ? K extends keyof TJobTypeDefinitions
    ? ChainReachMap<TJobTypeDefinitions>[K] & string
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
  [K in keyof TJobTypeDefinitions as TJobTypeDefinitions[K] extends { entry: true }
    ? K
    : never]: TJobTypeDefinitions[K];
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

export type ResolvedJobWithBlockers<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
> = ResolvedJob<TJobId, TJobTypeDefinitions, TJobTypeName, TChainTypeName> & {
  blockers: CompletedBlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>;
};

export type ContinuationJobs<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
  TChainTypeName extends string = JobTypeReachingEntry<TJobTypeDefinitions, TJobTypeName>,
> =
  JobTypeContinuation<TJobTypeDefinitions, TJobTypeName> extends infer TContinuation extends string
    ? {
        [K in TContinuation]: Job<
          TJobId,
          K,
          TChainTypeName,
          JobTypeProperty<TJobTypeDefinitions, K, "input">,
          JobTypeProperty<TJobTypeDefinitions, K, "output">,
          [JobTypeContinuation<TJobTypeDefinitions, K>] extends [never] ? false : true
        > &
          ({ status: "ready" } | { status: "scheduled" } | { status: "blocked" });
      }[TContinuation]
    : never;

export type ResolvedChain<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> =
  JobTypeChainNames<TJobTypeDefinitions, TJobTypeName> extends infer TChainTypeNames extends string
    ? {
        [K in TChainTypeNames]: Chain<
          TJobId,
          TJobTypeName,
          JobTypeProperty<TJobTypeDefinitions, K, "input">,
          Exclude<JobTypeProperty<TJobTypeDefinitions, K, "output">, undefined>
        >;
      }[TChainTypeNames]
    : never;

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

type MapToCompletedChains<TJobId, TBlockers extends readonly unknown[]> = {
  [K in keyof TBlockers]: TBlockers[K] extends Chain<TJobId, string, unknown, unknown>
    ? CompletedChain<TBlockers[K]>
    : TBlockers[K];
};

export type CompletedBlockerChains<
  TJobId,
  TJobTypeDefinitions extends BaseJobTypeDefinitions,
  TJobTypeName extends string,
> = MapToCompletedChains<TJobId, BlockerChains<TJobId, TJobTypeDefinitions, TJobTypeName>>;
