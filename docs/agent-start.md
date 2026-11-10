# HeliumTS application context

Read this once to implement a normal app. It is self-contained; no prerequisite reading or API lookup is required for the path below. Use HeliumTS 0.11.0 or later with a matching scaffolder. For an unfamiliar feature, query one exact public signature with `npx helium api NAME --from client` (or `server`). Static discovery: `npx helium inspect --rpc NAME --json` or `--route '/items/:id' --json`. These are lookup tools, not mandatory verification steps.

## Files and boundaries

- `src/pages/index.tsx` maps to `/`; `src/pages/items/index.tsx` to `/items`; `src/pages/items/[id].tsx` to `/items/:id`. Pages default-export a React component. Use `src/components/` for shared UI, `src/styles.css` for styles, `src/server/` for discoverable named `defineMethod` exports, and `helium.config.ts`/`vite.config.ts` for framework/build configuration.
- Import hooks, `Link`, and `useRouter` from `heliumts/client`. Import server primitives only in server files from `heliumts/server`. Browser imports from `heliumts/server` are unsupported.
- App RPC references come exclusively from generated `src/rpc.generated.ts`, using the relative path appropriate to the page. Never edit that file or import an application server implementation into browser code. Dev, check, typegen and build maintain the references from source without executing server modules during discovery.
- React/React DOM remain peers. RPC uses HTTP, streaming uses HTTP with length-prefixed MessagePack frames. Normal app code should use public hooks/references, not construct transport URLs, tokens, envelopes or batches.

## One validated, authenticated method and page

Integrate your real authentication in a **server-only** `src/server/session.ts` adapter with this contract: `getSession(headers: IncomingHttpHeaders): Promise<{ userId: string } | null>` (a synchronous result is also fine). It must verify the request's actual session, not trust an owner ID supplied in input. There is intentionally no permissive demo implementation here. Use your existing trusted session provider when the app supplies one.

```ts file=src/server/greeting.ts
import { defineMethod } from "heliumts/server";
import { getSession } from "./session";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const greet = defineMethod(
    async ({ name }: { name: string }, ctx) => {
        const session = await getSession(ctx.req.headers);
        if (!session) throw new Error("Authentication required");
        return { message: `Hello ${name}`, userId: session.userId };
    },
    {
        input(value: unknown) {
            if (!isRecord(value) || typeof value.name !== "string") {
                throw new Error("Expected a name");
            }
            const name = value.name.trim();
            if (!name || Array.from(name).length > 80) throw new Error("Invalid name");
            return { name };
        },
    }
);
```

`input` starts with unknown, validates/transforms fields, and returns the handler's explicit argument type. Throwing rejects malformed requests before the handler. An object check alone narrows to `object`, not `Record<string, unknown>`; use the type guard above rather than asserting a type. Unicode code-point limits use `Array.from(text).length`; JavaScript string length counts UTF-16 units. Omit/ignore extra fields deliberately; never spread unchecked input into persistence.

`ctx` is `HeliumContext`: headers are **`ctx.req.headers`**, not `ctx.headers`. Header values are Node strings/string arrays/undefined. `ctx.req.url` is the RPC URL, not the current browser page; send validated page parameters explicitly. Pass `ctx.signal` to cancellable upstream work. Never return/log cookies, authorization headers or the whole request.

```tsx file=src/pages/index.tsx
import { useFetch } from "heliumts/client";
import { greet } from "../rpc.generated";

export default function Home() {
    const { data, isLoading, error, refetch } = useFetch(greet, { name: "Helium" });
    if (isLoading) return <p>Loading...</p>;
    if (error) return <main><p role="alert">{error}</p>
        <button onClick={() => void refetch()}>Retry</button></main>;
    return <main><h1>{data?.message}</h1></main>;
}
```

Required method arguments must be provided. `useFetch(method, args, options)` returns `{ data, isLoading, error, stats, refetch }`; `data` is initially undefined, `error` is a string or null. `refetch()` retries a read; `enabled: false` postpones a valid request. It does not make invalid arguments valid. Choose explicit loading, error and empty/not-found states; `undefined` during loading is not a missing record. For detail reads returning null, show the app's not-found message/back link and no stale editor.

## Persistence, mutations and forms

Validation is not authorization. Authenticate **every** read/write on the server. Derive owner ID from the verified session; scope list/get/update/delete to it. Fetch/check ownership before changing a record; missing or another user's record must not be exposed or mutated. Return null/not-found or a safe error as the app contract requires. Denied writes must not report success. Validate all update fields before a single atomic write; malformed partial updates must not persist anything. Use the app's real persistent repository, not component state or reset-on-start arrays. Preserve rate limits, cancellation and all framework security checks.

`useCall(method, { invalidate: [relatedRead, otherRelatedRead] })` returns `{ call, isCalling, error, data, stats }`. `await call(args)` returns the inferred result; failures set error and **reject**, so catch promises in event handlers. For an edit affecting a list and a detail, invalidate both references (for example `[getTask, listTasks]`), including related filtered/summary reads. Do not recreate raw RPC requests. `callMethod` is the public imperative alternative outside hooks; it does not update hook state or invalidate queries automatically.

Keep form state local. For a form, `await mutation.submit(args)` returns `{status:"success",data}`, `{status:"error",error:RpcError}` or `{status:"busy"}` and suppresses same-hook rapid duplicate submissions synchronously. Use `isCalling` to disable the button; no extra ref lock or rejection catch is needed. Clear the draft only for success. This is per-hook guarding, not server idempotency; `call()` remains the concurrent/rejecting primitive for advanced flows. Keep the same form, user input and retry button after failure, show an accessible `role="alert"`, and clear/reset input only after success. Do not replace a failed mutation form with a route-wide error page. A save may use its returned record for immediate UI feedback while invalidated reads refresh.

For a detail editor, mount it only after the requested record is available. Key the editor by record identity and pass fetched values as initial props; this avoids a synchronization effect overwriting unsaved edits. After navigation, do not show a cached record for a different ID. Disable duplicate toggle/delete/save operations and show pending feedback.

## Navigation and URL state

Use `<Link href="/items">Items</Link>` for client navigation. Ordinary browser back/forward should work without full-document reloads. `useRouter()` returns `path`, `params`, `searchParams`, `push`, `replace`, `on`, `status`, `isNavigating`, `isPending`.

- Dynamic `[id]` values are in `router.params.id` (string or string array); narrow before use. `router.path` is the current pathname.
- `router.searchParams` is a `URLSearchParams`. There is no separate `useSearchParams` hook. Derive the displayed filter directly from the URL on each render, validating allowed values; do not initialize a disconnected local filter once and forget back/forward.
- To change a filter, clone the current parameters, set/delete the value, then `router.push(router.path + "?" + next.toString(), { scrollToTop: false })`. Use `push` when filter changes need history entries; `replace` when replacing the current entry is intended. Mutating the existing object alone does not navigate. Preserve unrelated parameters.
- Fetch keys include method and arguments. Pass the current validated URL filter/ID to the read, and invalidate the methods affected by writes. Keep real SSR/SSG differences explicit if the task requests those rendering modes; the normal interactive path here does not require them.

## Verify and exercise the app

Run `npm run verify` in a new starter: it runs check (generation + TypeScript), lint, production build, stopping on failure. Fix that failure, then rerun; separate typegen/typecheck calls are unnecessary in this sequence. In existing apps without verify, use their supplied check/lint/build scripts. Run only the task's required checks, not every lookup command as an additional check. File-writing shell scripts should stop on write failures before invoking verification; a successful check of an unchanged scaffold is not proof the intended app was written.

For runtime checks, start the built app with its supplied start command and use the **public browser UI/client references**: navigate list/detail/back/forward, submit valid and invalid forms, test pending/error/retry behavior, and check persistent data after restart and owner/anonymous isolation. Do not grep private `dist/` transport implementations or source maps to discover a wire protocol. If startup is denied by the environment (for example listen EPERM), report the concrete restriction; do not replace real validation with a protocol guess or claim the test passed. In an externally evaluated task, follow the supplied evaluator/repair workflow for runtime coverage.

If a specific gap remains, use one exact `api`/`inspect` lookup or the matching concept guide. Do not read the full reference or traverse prerequisite chains by default. Keep implementation and checks truthful; fewer bytes do not prove lower successful-task token usage.
