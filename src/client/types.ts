/**
 * Represents a server method stub that can be passed to client hooks like useFetch/useCall.
 * This type is compatible with HeliumMethodDef so that methods defined with defineMethod
 * can be passed directly to client hooks with proper type inference.
 *
 * Note: Using method shorthand syntax for `handler` makes it bivariant,
 * allowing HeliumMethodDef (with HeliumContext) to be assignable to MethodStub.
 */
export type MethodStub<TArgs = unknown, TResult = unknown> = {
    __kind: "method";
    __id: string;
    handler(args: TArgs, ctx: unknown): Promise<TResult> | TResult;
};
