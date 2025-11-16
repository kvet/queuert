// TODO: strong typing for log types
export type Log = (options: {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  args: any[];
}) => void;
