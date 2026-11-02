export type RpcRequest = {
    id: string | number;
    method: string;
    args?: unknown;
};

export type RpcStats = {
    remainingRequests: number;
    resetInSeconds: number;
};

export type RpcSuccess = {
    id: string | number;
    ok: true;
    stats: RpcStats;
    result: unknown;
};

export type RpcError = {
    id: string | number;
    ok: false;
    stats: RpcStats;
    error: string;
};

export type RpcResponse = RpcSuccess | RpcError;

export type RpcBatchRequest = RpcRequest[];
export type RpcBatchResponse = RpcResponse[];

/** Streaming RPC responses contain length-prefixed MessagePack frames. */
export const RPC_STREAM_CONTENT_TYPE = "application/x-helium-stream";
export const MAX_RPC_STREAM_FRAME_SIZE = 10 * 1024 * 1024;

export type RpcStreamFrame = { type: "chunk"; data: unknown } | { type: "done"; stats: RpcStats } | { type: "error"; error: string; stats: RpcStats };
