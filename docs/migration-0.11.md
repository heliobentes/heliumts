# Upgrade to HeliumTS 0.11.0

0.11.0 replaces generated application RPC stubs from `heliumts/server` with opaque, typed references in each application's `src/rpc.generated.ts`. This is a breaking change from 0.10.2. Server primitives stay in `heliumts/server`; React/React DOM remain peers and the Node/Vite requirements are unchanged.

1. Update the framework with `npm install heliumts@^0.11.0` and keep the resulting project lockfile. Use create-heliumts-app 0.11.0 for new applications.
2. Stop the old dev process. Remove the obsolete generated `src/types/heliumts-server.d.ts` if present; do not remove user-authored server types.
3. In browser pages/components, replace imports of app methods from `heliumts/server` or server implementation files with imports from the relative `src/rpc.generated.ts` module. Keep hooks/router imports from `heliumts/client` and server-side `defineMethod`, workers, HTTP handlers and other primitives from `heliumts/server`.
4. Run `npx helium check` to regenerate references and check types. `npx helium typegen` generates without starting a server. Do not hand-edit generated references. Resolve duplicate RPC names/equivalent dynamic routes when discovery reports them.
5. Supply required method arguments explicitly. Unary hooks reject streaming references; use `useStreaming` for async-iterable methods. Remove uses of the legacy `MethodStub` type and direct server definitions as client references.
6. For forms, `useCall(...).submit(args)` is additive: it handles success/error/busy outcomes and suppresses same-hook pending duplicates. Existing `call()` still rejects and permits concurrency. Keep explicit `invalidate` references for every affected read; successful submission does not wait for those reads to refresh.
7. Restart with the updated package and deploy matching client/server builds together. Existing applications can keep their verification commands; new starters provide `npm run verify` (check, lint, production build). Preserve task-specific runtime and security tests.

The HTTP RPC and streaming codec is unchanged: unary JSON/MessagePack and length-prefixed MessagePack stream frames. App code should use public hooks/references rather than construct private transport requests. Keep validation, authorization, rate limits, cancellation and error privacy. An optional `defineMethod(..., { input })` parser validates untrusted input before the handler; it does not replace authorization.

`helium inspect --rpc NAME --json`, `--route PATTERN --json` and `helium api NAME --from client|server` provide bounded source/API context. They are optional lookups, not a mandatory sequence. Read the installed `docs/agent-start.md` once for the normal application path.
