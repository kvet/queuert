import { NatsContainer } from "@testcontainers/nats";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";

export type ServiceKind = "postgres" | "redis" | "nats";

export const startService = async (
  kind: ServiceKind,
): Promise<{ env: Record<string, string>; stop: () => Promise<void> }> => {
  console.log(`\nStarting ${kind} container (shared by every scenario that needs it)...`);
  switch (kind) {
    case "postgres": {
      const container = await new PostgreSqlContainer("postgres:18").withExposedPorts(5432).start();
      return {
        env: { BENCHMARK_POSTGRES_URL: container.getConnectionUri() },
        stop: async () => {
          await container.stop();
        },
      };
    }
    case "redis": {
      const container = await new RedisContainer("redis:8").withExposedPorts(6379).start();
      return {
        env: { BENCHMARK_REDIS_URL: container.getConnectionUrl() },
        stop: async () => {
          await container.stop();
        },
      };
    }
    case "nats": {
      const container = await new NatsContainer("nats:2.10").withExposedPorts(4222).start();
      return {
        env: { BENCHMARK_NATS_OPTIONS: JSON.stringify(container.getConnectionOptions()) },
        stop: async () => {
          await container.stop();
        },
      };
    }
  }
};
