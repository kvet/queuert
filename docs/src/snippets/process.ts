const worker = await createInProcessWorker({
  client,
  processors: createProcessors({
    client,
    jobTypes,
    processors: {
      "provision-account": {
        attemptHandler: async ({ job, complete }) => {
          const accountId = await provisionAccount(job.input.userId);

          return withTransactionHooks(async (transactionHooks) =>
            db.transaction(async (tx) =>
              complete({
                tx,
                transactionHooks,
                continueWith: {
                  typeName: "send-welcome-email",
                  input: { userId: job.input.userId, accountId },
                  //      ↑ missing accountId would be a compile error
                },
              }),
            ),
          );
        },
      },
      // ...handlers for "send-welcome-email" and "sync-to-crm"
    },
  }),
});

const stop = await worker.start();
