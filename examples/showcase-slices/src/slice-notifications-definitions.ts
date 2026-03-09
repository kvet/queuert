import { defineJobTypeRegistry } from "queuert";

export const notificationJobTypeRegistry = defineJobTypeRegistry<{
  /*
   * Workflow:
   *   notifications.send-notification
   */
  "notifications.send-notification": {
    entry: true;
    input: { userId: string; channel: "email" | "sms"; message: string };
    output: { sentAt: string };
  };
}>();
