# HeliumTS contributor guide

HeliumTS is a React/Vite full-stack framework. RPC uses HTTP (JSON or MessagePack), not WebSockets. Streaming uses HTTP with length-prefixed MessagePack frames. File routes, HTTP handlers, SSR and SSG are supported.

## Boundaries
- `src/client`: browser hooks, router and transport. Never import application server implementations into browser code.
- `src/server`: server primitives, HTTP/RPC dispatch and security.
- `src/vite`: build-time discovery and generated modules. Discover source without executing application modules.
- `src/runtime`: shared protocol and route types.
- Import application hooks and routing from `heliumts/client` and server primitives from `heliumts/server`. App code gets RPC references exclusively from its generated `src/rpc.generated.ts` module; browser imports from `heliumts/server` are unsupported.
- Keep React/React DOM as peers. Do not remove validation, authorization, rate limiting, cancellation or regression coverage to reduce bytes.

## Workflow
Read only the relevant source and tests. `docs/agent/index.md` points to short application topics; `docs/agent-guide.md` is the full tested reference. Open only the topic needed. Longer guides remain in `docs/`.
Run `npm run build`, `npm run typecheck`, `npm test` and `npm run lint` after changes. `npm run test:smoke` exercises a built application. Install from the lockfile when possible. Do not edit generated `dist/` artifacts by hand.

Prefer additive, backward-compatible APIs, explicit diagnostics and executable examples. Keep genuine rendering differences explicit when sharing code. Fewer source tokens is not proof of lower AI usage: measure successful agent tasks, including read context, tool output and retries, before making cost or superiority claims.
