import type { UnknownChain, UnknownJob, WorkerWithRunningJobs } from "../../shared/types.ts";

export type FindChoice =
  | { kind: "chain"; chain: UnknownChain }
  | { kind: "job"; job: UnknownJob }
  | { kind: "worker"; worker: WorkerWithRunningJobs };

export type TypeSuggestion = { kind: "chain" | "job"; typeName: string };

export type FindOption = { href: string } & (
  | { choice: FindChoice }
  | { suggestion: TypeSuggestion }
);

export const choiceHref = (choice: FindChoice): string => {
  if (choice.kind === "chain") return `/chains/${choice.chain.id}`;
  if (choice.kind === "job") return `/jobs/${choice.job.id}`;
  return `/workers/${encodeURIComponent(choice.worker.id)}`;
};

export const typeSuggestionHref = (suggestion: TypeSuggestion): string =>
  `${suggestion.kind === "chain" ? "/chains" : "/jobs"}?typeName=${encodeURIComponent(suggestion.typeName)}`;

export const findOptions = (
  choices: readonly FindChoice[],
  suggestions: readonly TypeSuggestion[],
): FindOption[] =>
  choices.length > 0
    ? choices.map((choice) => ({ href: choiceHref(choice), choice }))
    : suggestions.map((suggestion) => ({ href: typeSuggestionHref(suggestion), suggestion }));
