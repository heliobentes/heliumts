declare const methodSignature: unique symbol;

/** A generated RPC method reference carrying its argument and result types. */
export type MethodReference<TArgs = never, TResult = unknown> = {
    readonly [methodSignature]: (args: TArgs) => TResult;
};

/** Generated references expose no server implementation or callable handler. */
export function getMethodId(method: MethodReference): string {
    const value = method as unknown as { __id?: unknown };
    if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || typeof value.__id !== "string" || !value.__id) {
        throw new Error("Expected a generated RPC reference from src/rpc.generated.ts.");
    }
    return value.__id;
}

/** Arguments are optional only when the method accepts undefined. */
export type MethodArgs<TArgs> = undefined extends TArgs ? [args?: TArgs] : [args: TArgs];

/** Streaming results must use useStreaming/streamRpc, never unary transport. */
type UnaryResult<TResult> = [Extract<TResult, AsyncIterable<unknown>>] extends [never] ? unknown : never;

export type UnaryMethod<TArgs, TResult> = MethodReference<TArgs, TResult> & UnaryResult<TResult>;
