# Changelog

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
