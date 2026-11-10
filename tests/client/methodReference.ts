import type { MethodReference } from "../../src/client/types";

/** The runtime shape emitted by typegen, without importing an application server. */
export function methodReference<TArgs = unknown, TResult = unknown>(id: string): MethodReference<TArgs, TResult> & { readonly __id: string } {
    return { __id: id } as unknown as MethodReference<TArgs, TResult> & { readonly __id: string };
}
