export {
  acquireNats,
  type AcquiredNats,
  extendWithNats,
  type NatsConnectionOptions,
} from "./nats.ts";
export { acquirePostgres, type AcquiredPostgres, extendWithPostgres } from "./postgres.ts";
export { acquireRedis, type AcquiredRedis, extendWithRedis } from "./redis.ts";
export {
  acquireRedisCluster,
  type AcquiredRedisCluster,
  extendWithRedisCluster,
  type RedisClusterConnection,
} from "./redis-cluster.ts";

// Resource types used by testcontainers connections that should be allowed in leak detection
export const TESTCONTAINERS_RESOURCE_TYPES: string[] = [
  "TCPSocketWrap", // TCP connections to containers
  "PipeWrap", // IPC pipes to containers
];
