# Use request context safely

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Define one validated method](./validation.md)

defineMethod handlers receive (args, ctx), where ctx has the public HeliumContext type from heliumts/server. Read request headers from ctx.req.headers, not ctx.headers. Values use Node's IncomingHttpHeaders shape: narrow string, string[] or undefined as appropriate.

ctx.req also contains ip, optional url and method, and the raw Node request. In RPC handlers, req.url is the RPC endpoint URL, not the browser page URL; pass page parameters explicitly as validated method arguments. Do not return or log authorization headers, cookies or the whole request.

ctx.signal is an AbortSignal for cancellation/disconnect. Pass it to upstream fetch/provider calls and clean up resources in finally. Cancellation only stops work that observes the signal. Middleware-added context fields are unknown until narrowed. For exact fields, read node_modules/heliumts/dist/server/context.d.ts; the public type is HeliumContext, not MethodContext or getRequestContext.

Related: [Find installed public API types](./api-reference.md), [Preserve application security](./security.md).
