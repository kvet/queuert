import { defineJobTypes } from "queuert";

export const notificationJobTypes = defineJobTypes<{
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
