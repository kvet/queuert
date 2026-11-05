import { A } from "@solidjs/router";

import { type FieldItem } from "../../FieldList.tsx";

/** The ID and limit options every state adapter factory takes, listed on each backend's page. */
export const stateAdapterConfigItems = (): FieldItem[] => [
  {
    name: "maxBlockersPerJob",
    chips: [{ label: "100", mono: true }],
    description: (
      <>
        The most blocker chains a single job may declare. Declaring more throws{" "}
        <code>BlockerLimitExceededError</code>; see{" "}
        <A href="/guides/job-blockers/#blocker-limit">Job Blockers</A>.
      </>
    ),
  },
  {
    name: "countCap",
    chips: [{ label: "10_000", mono: true }],
    description: (
      <>
        The per-status count at which <code>countChainsByTypeName</code> and{" "}
        <code>countJobsByTypeName</code> (and the dashboard's type counts) stop counting and report{" "}
        <code>hasMore</code>. A higher cap means a longer index scan per count.
      </>
    ),
  },
  {
    name: "generateJobId",
    chips: [{ label: "crypto.randomUUID", mono: true }],
    description: (
      <>
        Called for every job created without a caller-supplied <code>id</code>.
      </>
    ),
  },
  {
    name: "validateJobId",
    chips: [{ label: "accept all", mono: true }],
    description: (
      <>
        Runs on every caller-supplied and generated ID before writing, throwing{" "}
        <code>InvalidJobIdError</code> on failure.
      </>
    ),
  },
  {
    name: "generateWorkerId",
    chips: [{ label: "crypto.randomUUID", mono: true }],
    description: (
      <>
        Called once for each in-process worker created without a <code>workerId</code>; must return
        a new id on every call.
      </>
    ),
  },
  {
    name: "validateWorkerId",
    chips: [{ label: "accept all", mono: true }],
    description: (
      <>
        Runs on the configured or generated worker id; <code>createInProcessWorker</code> throws{" "}
        <code>InvalidWorkerIdError</code> on failure.
      </>
    ),
  },
];

/** The note under each backend's configuration list. */
export const StateAdapterConfigNote = () => (
  <p>
    <code>maxBlockersPerJob</code> and <code>countCap</code> must be positive integers; anything
    else throws when the adapter is created. The resolved values are readable on{" "}
    <code>stateAdapter.config</code>.
  </p>
);
