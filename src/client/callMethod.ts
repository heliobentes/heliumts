import { rpcCall, type RpcResult } from "./rpcClient.js";
import { getMethodId, type MethodArgs, type UnaryMethod } from "./types.js";

/**
 * Call a typed server method outside React hooks. Does not update hook state or
 * invalidate cached queries. Calls use HTTP and share the normal batch queue.
 */
export function callMethod<TArgs, TResult>(method: UnaryMethod<TArgs, TResult>, ...[args]: MethodArgs<NoInfer<TArgs>>): Promise<RpcResult<TResult>> {
    return rpcCall<TResult, TArgs>(getMethodId(method), args as TArgs);
}
