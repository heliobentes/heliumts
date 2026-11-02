import { rpcCall, type RpcResult } from "./rpcClient.js";
import type { MethodStub } from "./types.js";

/**
 * Call a typed server method outside React hooks. Does not update hook state or
 * invalidate cached queries. Calls use HTTP and share the normal batch queue.
 */
export function callMethod<TArgs, TResult>(method: MethodStub<TArgs, TResult>, args: TArgs): Promise<RpcResult<TResult>> {
    return rpcCall<TResult, TArgs>(method.__id, args);
}
