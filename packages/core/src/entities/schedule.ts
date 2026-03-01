/** Options for scheduling a job. Either an absolute `at` date or a relative `afterMs` delay in milliseconds. */
export type ScheduleOptions = { at: Date; afterMs?: never } | { at?: never; afterMs: number };
