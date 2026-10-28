type ChainJobStatus = "pending" | "running" | "completed";

export const chainJobs = [
  { typeName: "provision-account", id: "fb21e508…76f0", elapsed: "184ms" },
  { typeName: "send-welcome-email", id: "6db264fd…1510", elapsed: "312ms" },
  { typeName: "sync-to-crm", id: "11f447bc…ef7d", elapsed: "96ms" },
];

export const chainPhases: { statuses: ChainJobStatus[]; log: string }[] = [
  { statuses: ["pending"], log: "createChain provision-account · commits with your tx" },
  { statuses: ["running"], log: "worker-1 acquired provision-account" },
  { statuses: ["completed", "pending"], log: "complete → continueWith send-welcome-email" },
  { statuses: ["completed", "running"], log: "worker-2 acquired send-welcome-email" },
  {
    statuses: ["completed", "completed", "pending"],
    log: "complete → continueWith sync-to-crm",
  },
  { statuses: ["completed", "completed", "running"], log: "worker-1 acquired sync-to-crm" },
  {
    statuses: ["completed", "completed", "completed"],
    log: "complete → chain completed · output { syncedAt }",
  },
];

export const lastChainPhase = chainPhases.length - 1;

export const chainStatusAt = (step: number): "running" | "completed" => {
  const { statuses } = chainPhases[step];
  return statuses.length === chainJobs.length && statuses.at(-1) === "completed"
    ? "completed"
    : "running";
};

export const logWindowAt = (step: number, size: number): (string | undefined)[] => {
  const lines = chainPhases.slice(0, step + 1).map((phase) => phase.log);
  const window: (string | undefined)[] = lines.slice(-size);
  while (window.length < size) {
    window.push(undefined);
  }
  return window;
};
