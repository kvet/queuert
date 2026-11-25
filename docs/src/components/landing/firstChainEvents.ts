import type { ChainEvent } from "../tutorial/recorder.ts";

export const firstChainEvents: ChainEvent[] = [
  { kind: "chain-created", chainId: "0194f7a2c1", typeName: "send-welcome-email" },
  {
    kind: "job-created",
    jobId: "0194f7a2c1",
    chainId: "0194f7a2c1",
    typeName: "send-welcome-email",
    input: '{ userId: "ada" }',
    blocked: false,
  },
  { kind: "attempt-started", jobId: "0194f7a2c1", attempt: 1 },
  {
    kind: "job-completed",
    jobId: "0194f7a2c1",
    output: '{ sentAt: "2026-01-01T09:00:00.000Z" }',
  },
  {
    kind: "chain-completed",
    chainId: "0194f7a2c1",
    output: '{ sentAt: "2026-01-01T09:00:00.000Z" }',
  },
];
