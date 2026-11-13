export { acquireNats, type AcquiredNats, type NatsConnectionOptions } from "./nats.ts";
export { acquireMysql, type AcquiredMysql, type MysqlConnectionOptions } from "./mysql.ts";
export { acquirePostgres, type AcquiredPostgres } from "./postgres.ts";
export { acquireRedis, type AcquiredRedis } from "./redis.ts";
export {
  acquireRedisCluster,
  type AcquiredRedisCluster,
  type RedisClusterConnection,
} from "./redis-cluster.ts";

// Resource types used by testcontainers connections that should be allowed in leak detection
export const TESTCONTAINERS_RESOURCE_TYPES: string[] = [
  "TCPSocketWrap", // TCP connections to containers
  "PipeWrap", // IPC pipes to containers
];
