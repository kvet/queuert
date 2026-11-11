const ALLOWED_RESOURCE_TYPES = new Set([
  "TTYWrap", // stdin/stdout/stderr - always present
  "FSReqCallback", // File system callbacks - transient during test execution
  "GetAddrInfoReqWrap", // DNS lookups - transient
]);

export const detectResourceLeaks =
  (options?: { additionalAllowedTypes?: string[] }) =>
  async (
    // oxlint-disable-next-line no-empty-pattern -- vitest fixtures must destructure their context
    {}: object,
    { onCleanup }: { onCleanup: (cleanup: () => Promise<void>) => void },
  ): Promise<void> => {
    const allowedTypes = options?.additionalAllowedTypes
      ? new Set([...ALLOWED_RESOURCE_TYPES, ...options.additionalAllowedTypes])
      : ALLOWED_RESOURCE_TYPES;

    const baselineCounts = new Map<string, number>();
    for (const resource of process.getActiveResourcesInfo()) {
      baselineCounts.set(resource, (baselineCounts.get(resource) ?? 0) + 1);
    }

    onCleanup(async () => {
      // Small delay to let any cleanup handlers run
      await new Promise((resolve) => setImmediate(resolve));

      const afterCounts = new Map<string, number>();
      for (const resource of process.getActiveResourcesInfo()) {
        afterCounts.set(resource, (afterCounts.get(resource) ?? 0) + 1);
      }

      const leaked: string[] = [];
      for (const [resource, count] of afterCounts) {
        const baselineCount = baselineCounts.get(resource) ?? 0;
        const leakedCount = count - baselineCount;
        if (leakedCount > 0 && !allowedTypes.has(resource)) {
          leaked.push(`${resource} x${leakedCount}`);
        }
      }

      if (leaked.length > 0) {
        throw new Error(
          `Test leaked resources: ${leaked.join(", ")}\n` +
            `Full active resources: ${process.getActiveResourcesInfo().join(", ")}`,
        );
      }
    });
  };
