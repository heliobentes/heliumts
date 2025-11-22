import type { HeliumContext } from "./context.js";

export type HeliumMethodDef<TArgs = any, TResult = any> = {
    __kind: "method";
    __id: string;
    handler: (args: TArgs, ctx: HeliumContext) => Promise<TResult> | TResult;
};

export function defineMethod<TArgs, TResult>(handler: (args: TArgs, ctx: HeliumContext) => Promise<TResult> | TResult): HeliumMethodDef<TArgs, TResult> {
    if (!handler) {
        throw new Error("defineMethod requires a handler");
    }

    return {
        __kind: "method",
        __id: handler.name || "",
        handler,
    };
}
