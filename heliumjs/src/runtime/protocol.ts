export type RpcRequest = {
  id: string;
  method: string;
  args?: unknown;
};

export type RpcSuccess = {
  id: string;
  ok: true;
  result: unknown;
};

export type RpcError = {
  id: string;
  ok: false;
  error: { message: string; code?: string };
};

export type RpcResponse = RpcSuccess | RpcError;
