import { defineJobTypes } from "queuert";

export const notificationJobTypes = defineJobTypes<{
  /*
   * notifications.send-notification
   */
  "notifications.send-notification": {
    entry: true;
    input: { userId: string; message: string };
    output: { sentAt: string };
  };
}>();
