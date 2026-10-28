const client = await createClient({ stateAdapter, jobTypes });

await withTransactionHooks(async (transactionHooks) =>
  db.transaction(async (tx) => {
    const user = await tx.users.create({ name: "Alice", email: "alice@example.com" });

    await client.createChain({
      tx,
      transactionHooks,
      typeName: "provision-account",
      input: { userId: user.id },
      //         ↑ wrong shape here is a compile error
    });
  }),
);
