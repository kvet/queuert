export {
  acquireNats,
  type AcquiredNats,
  extendWithNats,
  type NatsConnectionOptions,
} from "./nats.js";
export { acquirePostgres, type AcquiredPostgres, extendWithPostgres } from "./postgres.js";
export { acquireRedis, type AcquiredRedis, extendWithRedis } from "./redis.js";
export {
  acquireRedisCluster,
  type AcquiredRedisCluster,
  extendWithRedisCluster,
  type RedisClusterConnection,
} from "./redis-cluster.js";

// Resource types used by testcontainers connections that should be allowed in leak detection
export const TESTCONTAINERS_RESOURCE_TYPES: string[] = [
  "TCPSocketWrap", // TCP connections to containers
  "PipeWrap", // IPC pipes to containers
];
