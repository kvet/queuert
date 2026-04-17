export { extendWithNats, type NatsConnectionOptions } from "./nats.js";
export { extendWithPostgres } from "./postgres.js";
export { extendWithRedis } from "./redis.js";
export { extendWithRedisCluster, type RedisClusterConnection } from "./redis-cluster.js";

// Resource types used by testcontainers connections that should be allowed in leak detection
export const TESTCONTAINERS_RESOURCE_TYPES: string[] = [
  "TCPSocketWrap", // TCP connections to containers
  "PipeWrap", // IPC pipes to containers
];
