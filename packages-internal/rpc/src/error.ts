export class RpcError extends Error {
  readonly status: number;

  constructor(message: string, options: { status: number; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "RpcError";
    this.status = options.status;
  }
}
