# Changelog

## 0.11.0 — 2026-11-10

- Add `useCall.submit()` with handled success/error/busy outcomes and same-hook synchronous pending protection; keep `call()` concurrent/rejecting and read invalidation explicit.
- Keep project memory optional and experimental; normal packages exclude all model assets. No general AI-efficiency claim is made from the exploratory pilots.
- Default to the minimal starter. Use `--template examples` for the tasks and streaming demo.
- Add a starter `npm run verify` pipeline (check, lint, build) and direct API/file lookup guidance to avoid overlapping verification and broad reference reads.
- Generate `src/rpc.generated.ts` with opaque, typed app RPC references. This replaces browser RPC imports from `heliumts/server` and their generated declarations.
- Remove the legacy `MethodStub` client types and direct server-definition acceptance; hooks and imperative calls require generated `MethodReference` values.
- Add `helium typegen`, `helium check` and source-only `helium inspect --json`.
- Add exact route/RPC inspection and bounded public declaration lookup with `helium api <symbol> --from client|server`; discover exported names with `helium api --list --match <fragment>`.
- Parse server exports rather than regex-matching comments and declarations; report duplicate names and equivalent dynamic routes.
- Require method arguments in unary hooks, infer mutation callbacks and reject unary/streaming misuse in TypeScript.
- Add optional schema-neutral `defineMethod(handler, { input })` parsing with safe public validation errors.
- Share typed SSR/SSG adapters, preserve their rendering differences and lazy-load CLI tooling.
- Keep existing server exports while moving generated-code helpers to `heliumts/internal`.
- Add a compact application reference with checked examples and accurate agent guidance.

Coordinated with create-heliumts-app 0.11.0; generated-only RPC imports are a breaking change from 0.10.2.

### Upgrade notes

- Switch browser RPC imports to `src/rpc.generated.ts`. Delete the old generated `src/types/heliumts-server.d.ts` if present and run `npx helium check`. Use `heliumts/server` for framework server primitives such as `defineMethod`.

## 0.10.2

- Hydrate SSR and SSG pages using their initial route instead of briefly selecting the home route, preserving server-rendered markup on direct visits.
- Replace the raw HTTP OpenAI streaming recipe with a typed `defineMethod` and `useStreaming` example, including upstream cancellation and partial failures.

## 0.10.1

- Validate MessagePack request structure before decoding in both RPC endpoints, bounding declared container sizes and nesting depth within the request-body limit.
- Reject malformed, truncated, and excessively nested requests before allocating decoded containers. Existing HTTP-only RPC and streaming APIs are unchanged.

## 0.10.0

- Use HTTP for all RPC calls and remove the framework WebSocket client, server, reconnection logic, transport detection, and direct socket dependencies. Vite HMR remains independent.
- Add typed `useStreaming` for methods returning async iterables, with incremental text/structured chunks, start/cancel/reset, callbacks, idle timeouts, and stale-run protection.
- Stream authenticated MessagePack frames with backpressure, bounded sizes, sanitized terminal errors, middleware, and cooperative upstream cancellation through `ctx.signal`.
- Simplify `callMethod` to return `{ data, stats }` and obtain HTTP authorization tokens on demand. Network failures and server errors no longer replay calls automatically.
- Remove transport comparison pages, fixtures, and marketing content; update the website, templates, and example with streaming demos.

### Upgrade notes

- Remove `rpc.transport`, `rpc.autoHttpOnMobile`, `rpc.compression`, `rpc.maxWsPayload`, and `rpc.security.maxConnectionsPerIP`; rename `maxMessagesPerWindow` to `maxRequestsPerWindow`.
- Remove `getRpcTransport`, `isAutoHttpOnMobileEnabled`, `preconnect`, `RpcTransport`, `CallMethodOptions`, explicit transport arguments, and response `transport` reads.
- RPC middleware now sees each HTTP POST with current cookies/headers. Rate limits are per-IP request windows; a batch envelope or stream counts as one request.
- `HeliumContext.signal` is required; supply an AbortSignal in hand-written context fixtures and pass it through upstream operations.
- Deploy the matching client and server builds together; cached older clients may still attempt the removed RPC socket endpoint.
- See [streaming methods](./docs/streaming.md) for LLM/provider cancellation, partial errors, and deployment requirements.

## 0.9.7

- Use Brotli quality 4 for dynamic HTTP RPC responses in development and production, avoiding maximum-quality compression on every request.
- Honor accepted HTTP compression encodings and quality weights, and apply WebSocket compression enablement and thresholds to both compression layers.
- Reduce serialization overhead for ordinary object properties while preserving safe handling of own `__proto__` properties.
- Add typed `callMethod` calls outside React hooks, report the transport used by each response, and honor explicit transport selection without automatic fallback.
- Keep HTTP retries from interrupting unrelated WebSocket requests, and support importing `callMethod` in SSR and SSG event handlers.
- Clarify that RPC latency depends on the network, payload, browser, and hosting path; persistent connections and MessagePack do not guarantee a speed advantage over HTTP.

## 0.9.6

- Fix stale query responses, cache invalidation races, overlapping mutation loading state, and page/layout state lost during navigation.
- Honor forced HTTP transport, cap client batches at the configured server limit, and time out stalled HTTP RPC and token requests.
- Enforce HTTP RPC rate limits; validate RPC envelopes and connection tokens; correct proxy IP and protocol trust; block static-file symlink escapes.
- Preserve streaming backpressure, shared request-body reads, cookies, and literal route characters; return useful errors for invalid and oversized bodies.
- Align SSR query props, application shells, layouts, transitions, metadata, and nested root replacement with client rendering.
- Fix Vite root/mode handling, server/client boundaries, special-file discovery, generated imports, and live handler reloads.
- Recognize SSR/SSG directives only in the page directive prologue, so strings inside code examples or comments cannot change rendering mode.
- Load TypeScript configuration with local helpers, fail on invalid configuration, and bundle production configuration into dist.
- Forward CLI shutdown signals and support project paths containing spaces. Fix worker cleanup, cancelled restarts, and retry counts.
- Update compatible dependencies and require Node.js 20.19+ within Node 20, or Node.js 22.12+.
- Add regression coverage and a consuming-app smoke test covering development, SSR/SSG, RPC, and production startup.

### Upgrade notes

- HTTP RPC now honors `maxMessagesPerWindow` per client IP; WebSocket message limits remain per connection.
- Review `trustProxyDepth`: selection counts the direct peer and reads forwarding chains from the right. Proxy headers are ignored at depth zero.
- Import application RPC stubs from `heliumts/server` in browser components; direct imports of server implementation files now fail. Keep SSR server-only imports in page sidecars.
- Invalid configuration and unexpected SSR failures now produce errors instead of silently falling back.
- `maxRestarts` counts retries after the initial worker attempt, as documented.

## 0.9.5

- Preserve all `Set-Cookie` headers when forwarding a Web `Response` to Node.js. Authentication callbacks can now set a session token alongside state and cache cookies without losing earlier cookies and redirecting users back to login.
- Add regression coverage for redirects with zero, one, and multiple cookies, including cookie expiration dates containing commas.
