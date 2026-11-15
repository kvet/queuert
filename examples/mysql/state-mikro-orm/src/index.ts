import assert from "node:assert/strict";

import { IsolationLevel, MikroORM, defineEntity, p } from "@mikro-orm/mysql";
import { createMysqlStateAdapter } from "@queuert/mysql";
import { acquireMysql } from "@queuert/testcontainers";
import { createClient, createProcessors, createWorkerRunner, defineJobTypes } from "queuert";

import { createMikroOrmMysqlStateProvider } from "./provider.ts";

await using mysql = await acquireMysql("mysql:26", import.meta.url);

const UserSchema = defineEntity({
  name: "User",
  properties: {
    id: p.integer().primary(),
    name: p.string(),
    email: p.string(),
  },
});
class User extends UserSchema.class {}
UserSchema.setClass(User);

// #region orm
await using orm = await MikroORM.init({
  entities: [User],
  host: mysql.connectionOptions.host,
  port: mysql.connectionOptions.port,
  user: mysql.connectionOptions.user,
  password: mysql.connectionOptions.password,
  dbName: mysql.connectionOptions.database,
  schemaGenerator: { skipTables: [/^queuert_/] },
});
// #endregion
await orm.schema.create();

const jobTypes = defineJobTypes<{
  send_welcome_email: {
    entry: true;
    input: { userId: number };
    output: { sentAt: string };
  };
}>();

const readCommitted = { isolationLevel: IsolationLevel.READ_COMMITTED };

// #region adapter
const stateProvider = createMikroOrmMysqlStateProvider({ orm });
await using stateAdapter = createMysqlStateAdapter({ stateProvider, dialect: "mysql" });
await stateAdapter.migrateToLatest();
// #endregion

assert.doesNotMatch(await orm.schema.getUpdateSchemaSQL(), /queuert_/);

const client = createClient({ stateAdapter, jobTypes });

await using workerRunner = createWorkerRunner({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      send_welcome_email: {
        attemptHandler: async ({ job, complete }) => {
          const user = await orm.em.fork().findOneOrFail(User, { id: job.input.userId });

          console.log(`Sending welcome email to ${user.email} for ${user.name}`);

          return orm.em.transactional(
            async (em) => complete({ em, output: { sentAt: new Date().toISOString() } }),
            readCommitted,
          );
        },
      },
    },
  }),
});

await workerRunner.start();

// #region create-chain
const chain = await orm.em.transactional(async (em) => {
  const user = em.create(User, { name: "Alice", email: "alice@example.com" });
  await em.flush();

  return client.createChain({
    em,
    typeName: "send_welcome_email",
    input: { userId: user.id },
  });
}, readCommitted);
// #endregion

const result = await client.awaitChain(chain, { timeoutMs: 5000 });
console.log(`Welcome email sent at: ${result.output.sentAt}`);

// #region savepoint
const cancelledChainId = crypto.randomUUID();
await orm.em.transactional(async (em) => {
  await em
    .transactional(async (em) => {
      const user = em.create(User, { name: "Bob", email: "bob@example.com" });
      await em.flush();
      await client.createChain({
        em,
        id: cancelledChainId,
        typeName: "send_welcome_email",
        input: { userId: user.id },
      });
      throw new Error("Bob's signup was cancelled");
    })
    .catch((error: unknown) => {
      console.log(`Savepoint rolled back: ${(error as Error).message}`);
    });

  em.create(User, { name: "Carol", email: "carol@example.com" });
}, readCommitted);
// #endregion

assert.equal(await client.getChain({ id: cancelledChainId }), undefined);
assert.equal(await orm.em.fork().count(User, { name: "Bob" }), 0);
assert.equal(await orm.em.fork().count(User, { name: "Carol" }), 1);
console.log("Carol committed; Bob's cancelled signup left no user and no chain");
