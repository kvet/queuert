export { extendWithMongodb } from "./mongodb.js";
export { extendWithNats, type NatsConnectionOptions } from "./nats.js";
export { extendWithPostgres } from "./postgres.js";
export { extendWithRedis } from "./redis.js";

// Resource types used by testcontainer connections that should be allowed in leak detection
export const TESTCONTAINER_RESOURCE_TYPES: string[] = [
  "TCPSocketWrap", // TCP connections to containers
  "PipeWrap", // IPC pipes to containers
];
