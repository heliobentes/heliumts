export type RpcRequest = {
    id: string;
    method: string;
    args?: unknown;
};

export type RpcStats = {
    remainingRequests: number;
    resetInSeconds: number;
};

export type RpcSuccess = {
    id: string;
    ok: true;
    stats: RpcStats;
    result: unknown;
};

export type RpcError = {
    id: string;
    ok: false;
    stats: RpcStats;
    error: string;
};

export type RpcResponse = RpcSuccess | RpcError;
