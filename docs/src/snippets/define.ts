const jobTypes = defineJobTypes<{
  "provision-account": {
    entry: true;
    input: { userId: string };
    continueWith: { typeName: "send-welcome-email" };
  };
  "send-welcome-email": {
    input: { userId: string; accountId: string };
    continueWith: { typeName: "sync-to-crm" };
  };
  "sync-to-crm": {
    input: { userId: string; accountId: string };
    output: { syncedAt: string };
  };
}>();
