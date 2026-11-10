// Compile-only regression tests, included by npm run typecheck.
import type { SubmitResult } from "../../src/client/index";
import { callMethod } from "../../src/client/callMethod";
import type { MethodReference } from "../../src/client/types";
import { useCall } from "../../src/client/useCall";
import { useFetch } from "../../src/client/useFetch";
import { useStreaming } from "../../src/client/useStreaming";
import type { HeliumMethodDef } from "../../src/server/defineMethod";
import { defineMethod } from "../../src/server/defineMethod";

// Model the type-only extraction performed by rpc.generated.ts.
function reference<TArgs, TResult>(_method: HeliumMethodDef<TArgs, TResult>): MethodReference<TArgs, Awaited<TResult>> {
    return {} as MethodReference<TArgs, Awaited<TResult>>;
}

export function checkRpcTypes() {
    const required = reference(defineMethod((args: { id: string }) => ({ name: args.id })));
    const optional = reference(defineMethod((args?: { id: string }) => args?.id ?? "none"));
    const noArgs = reference(defineMethod(() => 42));
    const stream = reference(
        defineMethod(async function* (args: { id: string }) {
            yield args.id;
        })
    );
    const serverOnly = defineMethod(() => true);
    // @ts-expect-error Server implementations are not browser RPC references.
    useFetch(serverOnly);
    // @ts-expect-error Server implementations are not browser RPC references.
    useCall(serverOnly);
    // @ts-expect-error Server implementations are not browser RPC references.
    callMethod(serverOnly);
    useStreaming(
        // @ts-expect-error Server implementations are not browser RPC references.
        defineMethod(async function* () {
            yield 1;
        })
    );
    useFetch(required, { id: "ok" });
    // @ts-expect-error Required arguments cannot be omitted.
    useFetch(required);
    // @ts-expect-error Required arguments cannot be undefined.
    useFetch(required, undefined);
    // @ts-expect-error Arguments cannot widen the method's declared input type.
    useFetch(required, { id: 42 });
    useFetch(optional);
    useFetch(noArgs);
    const mutation = useCall(required, {
        onSuccess: (result) => {
            const name: string = result.name;
            void name;
        },
    });
    const result: Promise<{ name: string }> = mutation.call({ id: "ok" });
    const submitted: Promise<SubmitResult<{ name: string }>> = mutation.submit({ id: "ok" });
    submitted.then((outcome) => {
        if (outcome.status === "success") {
            const name: string = outcome.data.name;
            void name;
        }
        if (outcome.status === "error") {
            const message: string = outcome.error.message;
            void message;
        }
    });
    // @ts-expect-error Required submission arguments cannot be omitted.
    mutation.submit();
    // @ts-expect-error Submission must retain inferred scalar input types.
    mutation.submit({ id: 42 });
    useCall(noArgs).submit();
    useCall(optional).submit();
    const data: { name: string } | undefined = mutation.data;
    void result;
    void data;
    // @ts-expect-error Mutation args are required.
    mutation.call();
    useCall(noArgs).call();
    useCall(optional).call();
    callMethod(noArgs);
    // @ts-expect-error Required arguments cannot be omitted.
    callMethod(required);
    // @ts-expect-error Unary queries cannot consume streaming methods.
    useFetch(stream, { id: "ok" });
    // @ts-expect-error Unary mutations cannot consume streaming methods.
    useCall(stream);
    // @ts-expect-error Unary imperative calls cannot consume streaming methods.
    callMethod(stream, { id: "ok" });
    // @ts-expect-error Streaming hooks cannot consume unary methods.
    useStreaming(required);
    useStreaming(stream, {
        onChunk: (chunk) => {
            const value: string = chunk;
            void value;
        },
    }).start({ id: "ok" });
    const mixed = reference(
        defineMethod((args: { stream: boolean }): string | AsyncIterable<string> =>
            args.stream
                ? (async function* () {
                      yield "ok";
                  })()
                : "ok"
        )
    );
    // @ts-expect-error A possibly streaming method cannot use unary transport.
    useCall(mixed);
    useCall(required, {
        // @ts-expect-error onSuccess must use the method's actual result type.
        onSuccess: (value: number) => {
            void value;
        },
    });
    const optionalStream = reference(
        defineMethod(async function* () {
            yield 1;
        })
    );
    useStreaming(optionalStream).start();
    const validated = reference(defineMethod((args: { id: number }) => args.id, { input: { parse: (value: unknown) => ({ id: Number(value) }) } }));
    const value: Promise<number> = useCall(validated).call({ id: 1 });
    void value;
}

export async function checkMethodReferenceTypes(
    read: MethodReference<{ id: string }, { name: string }>,
    optional: MethodReference<{ id: string } | undefined, string>,
    stream: MethodReference<{ id: string }, AsyncIterable<string>>,
    mixed: MethodReference<void, string | AsyncIterable<string>>
) {
    const data: { name: string } | undefined = useFetch(read, { id: "ok" }).data;
    const result: { name: string } = (await callMethod(read, { id: "ok" })).data;
    const mutation = useCall(read, { invalidate: [read, optional] });
    const pending: Promise<{ name: string }> = mutation.call({ id: "ok" });
    void data;
    void result;
    void pending;

    useFetch(optional);
    useCall(optional).call();
    callMethod(optional);
    useStreaming(stream, {
        onChunk: (chunk) => {
            const value: string = chunk;
            void value;
        },
    }).start({ id: "ok" });

    // @ts-expect-error A generated reference does not expose the handler.
    read.handler({ id: "ok" });
    // @ts-expect-error RPC identifiers are internal to the reference.
    void read.__id;
    // @ts-expect-error Only a generated reference can identify a method.
    callMethod({ __id: "read" }, { id: "ok" });
    // @ts-expect-error Reference inputs cannot be widened by arguments.
    useFetch(read, { id: 42 });
    // @ts-expect-error Assigning a reference cannot widen its declared arguments.
    const widened: MethodReference<unknown, { name: string }> = read;
    void widened;
    // @ts-expect-error The generated reference requires arguments.
    callMethod(read);
    // @ts-expect-error The generated reference requires arguments.
    mutation.call();
    // @ts-expect-error Streaming references require arguments.
    useStreaming(stream).start();
    // @ts-expect-error Unary queries cannot consume streaming references.
    useFetch(stream, { id: "ok" });
    // @ts-expect-error Unary mutations cannot consume streaming references.
    useCall(stream);
    // @ts-expect-error Unary imperative calls cannot consume streaming references.
    callMethod(stream, { id: "ok" });
    // @ts-expect-error A possibly streaming reference cannot use unary transport.
    useCall(mixed);
    // @ts-expect-error Streaming hooks cannot consume unary references.
    useStreaming(read);
}
