import { rpcCallWithOptions, type RpcResult } from "./rpcClient.js";
import type { MethodStub } from "./types.js";

export type CallMethodOptions = {
    /** Use a specific transport without automatic fallback to another transport. */
    transport?: "http" | "websocket";
};

/**
 * Call a typed server method outside React hooks. Does not update hook state or
 * invalidate cached queries. Omit transport to use the configured selection and
 * fallback behavior; the result reports the transport used for the response.
 */
export function callMethod<TArgs, TResult>(method: MethodStub<TArgs, TResult>, args: TArgs, options: CallMethodOptions = {}): Promise<RpcResult<TResult>> {
    return rpcCallWithOptions<TResult, TArgs>(method.__id, args, options);
}
