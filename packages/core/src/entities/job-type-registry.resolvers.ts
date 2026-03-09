import { type CompletedJobChain, type JobChain } from "./job-chain.types.js";
import {
  type JobTypeReference,
  type NominalJobTypeReference,
  type StructuralJobTypeReference,
} from "./job-type.js";
import { type BaseNavigationMap } from "./job-type-registry.navigation.js";
import { type Job } from "./job.js";

// ─── Internal helpers ───

type _NavChainTypeNames<
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName,
  _Visited = never,
> = [TJobTypeName] extends [never]
  ? _Visited
  : TJobTypeName extends _Visited
    ? _Visited
    : TJobTypeName extends keyof TNavigationMap & string
      ? _NavChainTypeNames<
          TNavigationMap,
          TNavigationMap[TJobTypeName]["continuationTypes"],
          _Visited | TJobTypeName
        >
      : _Visited;

// ─── Consumer types (operate on TNavigationMap — a NavigationMap) ───

export type EntryJobTypeDefinitions<TNavigationMap extends BaseNavigationMap> = {
  [K in keyof TNavigationMap as TNavigationMap[K]["isEntry"] extends true
    ? K
    : never]: TNavigationMap[K];
};

export type ContinuationJobTypes<
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap,
> = TNavigationMap[TJobTypeName]["continuationTypes"];

export type ChainJobTypeNames<
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap,
> = _NavChainTypeNames<TNavigationMap, TJobTypeName> & string;

export type ChainTypesReaching<
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap,
> = TNavigationMap[TJobTypeName]["reachingEntries"];

export type JobTypeHasBlockers<
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap,
> = TNavigationMap[TJobTypeName]["hasBlockers"];

export type ResolvedJob<
  TJobId,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
  TChainTypeName extends string = TNavigationMap[TJobTypeName]["reachingEntries"],
> = Job<TJobId, TJobTypeName, TChainTypeName, TNavigationMap[TJobTypeName]["input"]>;

export type ResolvedJobWithBlockers<
  TJobId,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
  TChainTypeName extends string = TNavigationMap[TJobTypeName]["reachingEntries"],
> = Job<TJobId, TJobTypeName, TChainTypeName, TNavigationMap[TJobTypeName]["input"]> & {
  blockers: CompletedBlockerChains<TJobId, TNavigationMap, TJobTypeName>;
};

export type ContinuationJobs<
  TJobId,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
  TChainTypeName extends string = TNavigationMap[TJobTypeName]["reachingEntries"],
> = TNavigationMap[TJobTypeName]["continuationTypes"] extends infer TCont extends
  keyof TNavigationMap & string
  ? {
      [K in TCont]: Job<TJobId, K, TChainTypeName, TNavigationMap[K]["input"]> &
        ({ status: "pending" } | { status: "blocked" });
    }[TCont]
  : never;

export type ResolvedJobChain<
  TJobId,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
> =
  _NavChainTypeNames<TNavigationMap, TJobTypeName> extends infer TChainTypeNames extends
    keyof TNavigationMap & string
    ? {
        [K in TChainTypeNames]: JobChain<
          TJobId,
          TJobTypeName,
          TNavigationMap[K]["input"],
          TNavigationMap[K]["output"]
        >;
      }[TChainTypeNames]
    : never;

export type ResolvedChainJobs<
  TJobId,
  TNavigationMap extends BaseNavigationMap,
  TChainTypeName extends keyof TNavigationMap & string,
> =
  _NavChainTypeNames<TNavigationMap, TChainTypeName> extends infer TChainTypeNames extends
    keyof TNavigationMap & string
    ? {
        [K in TChainTypeNames]: Job<TJobId, K, TChainTypeName, TNavigationMap[K]["input"]>;
      }[TChainTypeNames]
    : never;

// ─── Blocker types ───

type _MatchingNavTypesByInput<TNavigationMap extends BaseNavigationMap, TInput> = {
  [K in keyof TNavigationMap & string]: [TInput] extends [TNavigationMap[K]["input"]] ? K : never;
}[keyof TNavigationMap & string];

type _ResolveReferenceFromNav<TNavigationMap extends BaseNavigationMap, TRef> =
  TRef extends NominalJobTypeReference<infer TN>
    ? TN & keyof TNavigationMap
    : TRef extends StructuralJobTypeReference<infer TI>
      ? _MatchingNavTypesByInput<TNavigationMap, TI>
      : never;

type _ReferenceToChain<TJobId, TNavigationMap extends BaseNavigationMap, TRef> = ResolvedJobChain<
  TJobId,
  TNavigationMap,
  _ResolveReferenceFromNav<TNavigationMap, TRef> & keyof TNavigationMap & string
>;

type _MapBlockersToChains<
  TJobId,
  TNavigationMap extends BaseNavigationMap,
  TBlockers extends readonly unknown[],
> = {
  [K in keyof TBlockers]: TBlockers[K] extends JobTypeReference
    ? _ReferenceToChain<TJobId, TNavigationMap, TBlockers[K]>
    : never;
};

export type BlockerChains<
  TJobId,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
> = TNavigationMap[TJobTypeName]["hasBlockers"] extends false
  ? []
  : TNavigationMap[TJobTypeName]["blockerRefs"] extends infer TBlockers
    ? [TBlockers] extends [never]
      ? []
      : TBlockers extends readonly unknown[]
        ? _MapBlockersToChains<TJobId, TNavigationMap, TBlockers>
        : []
    : [];

type _BlockerRefChainNames<
  TNavigationMap extends BaseNavigationMap,
  TNavigationMapEntry,
> = TNavigationMapEntry extends {
  blockerRefs: readonly (infer TRef)[];
}
  ? _ResolveReferenceFromNav<TNavigationMap, TRef>
  : never;

export type BlockedJobTypeNames<
  TNavigationMap extends BaseNavigationMap,
  TBlockerChainTypeName extends string,
> = {
  [K in keyof TNavigationMap & string]: TBlockerChainTypeName extends _BlockerRefChainNames<
    TNavigationMap,
    TNavigationMap[K]
  >
    ? K
    : never;
}[keyof TNavigationMap & string];

type _MapToCompletedChains<TJobId, TBlockers extends readonly unknown[]> = {
  [K in keyof TBlockers]: TBlockers[K] extends JobChain<TJobId, string, unknown, unknown>
    ? CompletedJobChain<TBlockers[K]>
    : TBlockers[K];
};

export type CompletedBlockerChains<
  TJobId,
  TNavigationMap extends BaseNavigationMap,
  TJobTypeName extends keyof TNavigationMap & string,
> = TNavigationMap[TJobTypeName]["hasBlockers"] extends false
  ? []
  : _MapToCompletedChains<TJobId, BlockerChains<TJobId, TNavigationMap, TJobTypeName>>;
