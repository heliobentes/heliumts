import type { HeliumContext } from "./context.js";

export type HeliumMethodDef<TArgs = any, TResult = any> = {
    __kind: "method";
    __id: string;
    handler: (args: TArgs, ctx: HeliumContext) => Promise<TResult> | TResult;
};

/** A schema-library-neutral parser. Return validated arguments or throw/reject. */
export type MethodInputParser<TArgs> = ((input: unknown) => TArgs | Promise<TArgs>) | { parse(input: unknown): TArgs | Promise<TArgs> };

export interface DefineMethodOptions<TArgs> {
    /** Validate and optionally transform untrusted input before the handler runs. */
    input?: MethodInputParser<TArgs>;
}

/** Safe public error: parser details and the submitted input are never exposed. */
export class MethodInputError extends Error {
    readonly public = true;
    constructor() {
        super("Invalid method arguments");
        this.name = "MethodInputError";
    }
}

/**
 * Create a Helium server method definition from a handler function.
 *
 * Methods defined with `defineMethod` are discovered by the build/dev tooling
 * to generate typed RPC references for clients. The returned object contains the
 * `handler` and an `__id` that is used to identify the method at runtime.
 *
 * @typeParam TArgs - the expected arguments type for the handler
 * @typeParam TResult - the handler's return type
 * @param handler - function that receives (args, ctx) and returns a result or Promise
 * @param options - optional parser for untrusted arguments; throw/reject to reject input
 * @returns a HeliumMethodDef that can be registered by the server runtime
 */
export function defineMethod<TArgs, TResult>(
    handler: (args: TArgs, ctx: HeliumContext) => Promise<TResult> | TResult,
    options: DefineMethodOptions<TArgs> = {}
): HeliumMethodDef<TArgs, TResult> {
    if (!handler) {
        throw new Error("defineMethod requires a handler");
    }

    const input = options.input;
    const validatedHandler: typeof handler = input
        ? async (args, ctx) => {
              let parsed: TArgs;
              try {
                  parsed = await (typeof input === "function" ? input(args) : input.parse(args));
              } catch {
                  throw new MethodInputError();
              }
              // Validation may be asynchronous; never start work after disconnect.
              ctx.signal?.throwIfAborted();
              return handler(parsed, ctx);
          }
        : handler;

    return {
        __kind: "method",
        __id: handler.name || "",
        handler: validatedHandler,
    };
}
