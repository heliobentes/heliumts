# HeliumTS compact application reference

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

## Start and verify

### Orient in an installed app

Read the app's AGENTS.md first. For a known app method or route, use `npx helium inspect --rpc name --json` or `--route '/posts/:id' --json`. For an exact framework signature, use `npx helium api useCall --from client --json` or `npx helium api defineMethod --from server --json`. Discover unknown API names with `npx helium api --list --match fragment`.

Open one focused topic from node_modules/heliumts/docs/agent/index.md when you need a concept or example. Follow prerequisite links only to fill a gap; the full reference at node_modules/heliumts/docs/agent-guide.md is available for broader context.

### Scaffold a minimal app

```bash
npm create heliumts-app@latest my-app
cd my-app
npm run dev
```

The default starter has one page, one typed RPC method and plain CSS. Pass `--template examples` for the tasks and streaming demo, or `--tailwind` for Tailwind CSS. If you pass `--skip-install`, run `npm install` before starting the dev server.

### Verify an application

In a new starter, run the single verification script:

```bash
npm run verify
```

It runs `check`, `lint`, then `build` once each and stops on the first failure. Fix that failure and rerun verify. Check generates `src/rpc.generated.ts`, validates discovery and checks every referenced TypeScript project. A separate typegen or typecheck invocation is unnecessary in this sequence. Keep runtime tests required by your task; production build and type checks do not replace them.

For an existing app without verify, run its supplied check, lint and production-build scripts. `helium check` itself remains generation plus TypeScript: it does not run app scripts. `helium typegen` is available for generation alone; dev and build also keep RPC references current. Treat the RPC module as generated output.

Use inspect/api only to answer a specific discovery question, before verification when needed; they are not extra verification stages.

### Open the guide index

Read the Markdown index shipped with the installed framework:

```bash
cat node_modules/heliumts/docs/agent/index.md
```

The index groups 22 focused task guides by subject and links directly to their Markdown files. Choose only the guide needed for the current task. The full compact reference remains at node_modules/heliumts/docs/agent-guide.md.

### Read one guide

Open the Markdown file linked from the index. For example, the validation guide contains the complete server method example:

```bash
cat node_modules/heliumts/docs/agent/validation.md
```

Read the whole short guide so prerequisites, complete examples and related links stay together. Each guide includes its release warning and belongs to the installed framework package. Check node_modules/heliumts/package.json if you need the exact installed version. Follow prerequisite links only when the task needs that background; use the full compact reference for a task spanning several subjects.

## Imports and files

### Keep imports at the right boundary

- Import hooks, `Link` and router APIs from `heliumts/client`.
- Define server methods and middleware with primitives from `heliumts/server`.
- In browser application files, import RPC method references from the generated `src/rpc.generated.ts` module. For a page in `src/pages/`, use `../rpc.generated`. Pass the reference to a client hook or call helper to infer the method's arguments and result.
- Never import src/server implementations directly into browser files. Keep credentials, database clients and authorization on the server.
- Generated server bundles use heliumts/internal for framework helpers; application code should not import this internal entry point. Older helper exports from heliumts/server remain compatible.
- Use heliumts/vite only in build configuration. The package root is a namespace convenience, not the preferred browser import.

When upgrading from 0.10.2, switch browser RPC imports from `heliumts/server` to your generated module, delete the old generated `src/types/heliumts-server.d.ts` if it exists, and run `npx helium check`.
### Find installed public API types

Use public imports from heliumts/client and heliumts/server. Look up one exact exported symbol in the installed package without loading application modules:

```bash
npx helium api useCall --json
npx helium api useRouter --from client --json
npx helium api defineMethod --from server --json
npx helium api UseCallOptions --from client --json
```

If you do not know a symbol name, discover public names first:

```bash
npx helium api --list --from client --match router --json
npx helium api --list --from server --match method --json
```

Then look up one returned name. --match requires --list and matches a case-insensitive literal name fragment, not a regular expression. A symbol lookup and --list cannot be combined. Listings are sorted, include public aliases and type exports, and report an empty array when nothing matches. Declaration kinds do not imply runtime availability: an export may be type-only. More than 100 matches or 16 KiB of output fails with a request to narrow the filter; results are never silently truncated.

The default entrypoint is client. The result retains overloads, generics and documentation comments, with declaration source paths and related public type names for follow-up queries. Unexported local type shapes are included one level deep for reference, not as import suggestions. Other local, built-in and external references may remain; excerpts are not standalone code. The public module and selected name identify the supported import, even when the declaration uses a different internal alias. Output is capped at 16 KiB; missing, private or oversized lookups fail explicitly. This tool reads this installed framework's declarations, not application-generated RPC methods (use inspect --rpc for those).

If needed, open only the relevant declaration in the installed package:

- Client exports: node_modules/heliumts/dist/client/index.d.ts.
- Read and mutation hooks: node_modules/heliumts/dist/client/useFetch.d.ts and node_modules/heliumts/dist/client/useCall.d.ts.
- Router state and navigation: node_modules/heliumts/dist/client/Router.d.ts.
- Server exports: node_modules/heliumts/dist/server/index.d.ts.
- Request context and method options: node_modules/heliumts/dist/server/context.d.ts and node_modules/heliumts/dist/server/defineMethod.d.ts.

For a symbol search, restrict output to declarations:

```bash
rg -n -g '*.d.ts' 'useRouter|useCall' node_modules/heliumts/dist/client
```

Avoid recursively searching generated JavaScript or source maps for API signatures; those files can produce very large tool outputs.

These are files to read, not application deep-import paths. There is no dist/client/hooks directory. Longer docs linked on the source repository are not all shipped in the npm package; use this task index and the installed declarations first. Check the installed package version before relying on external examples.

### Place discoverable server files

Put pages under src/pages, methods under src/server and middleware in src/server/_middleware.ts. Start with the explicit exported defineMethod form below; discovery also supports import aliases, typed declarations and relative re-exports within src/server. Arbitrary wrapper factories, computed calls and tsconfig path aliases are not inferred; use an explicit defineMethod export at the discovery boundary.

## One validated method and page

### Define one validated method

In the framework repository, npm run test:docs compiles these two examples together and tests the extracted server example with valid and malformed inputs.

```ts file=src/server/greeting.ts
import { defineMethod } from "heliumts/server";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const greet = defineMethod(
    ({ name }: { name: string }) => ({ message: `Hello ${name}` }),
    {
        input(value: unknown) {
            if (!isRecord(value) || typeof value.name !== "string") {
                throw new Error("Expected a name");
            }
            const name = value.name.trim();
            if (!name || name.length > 80) throw new Error("Invalid name");
            return { name };
        },
    }
);
```

Start with unknown, narrow to a record, then validate each field before using it. Keep the handler argument type explicit so the parser return and client arguments agree; return the transformed object rather than asserting a type with a cast.

### Understand input parser behavior

The optional input parser accepts unknown and returns validated arguments, synchronously or asynchronously. A parser object with parse(input) is also supported. Parser failures return a safe Invalid method arguments error without leaking submitted values or schema details. TypeScript types alone do not validate network input. Validation does not replace authentication or ownership checks in the handler/middleware.

### Use request context safely

defineMethod handlers receive (args, ctx), where ctx has the public HeliumContext type from heliumts/server. Read request headers from ctx.req.headers, not ctx.headers. Values use Node's IncomingHttpHeaders shape: narrow string, string[] or undefined as appropriate.

ctx.req also contains ip, optional url and method, and the raw Node request. In RPC handlers, req.url is the RPC endpoint URL, not the browser page URL; pass page parameters explicitly as validated method arguments. Do not return or log authorization headers, cookies or the whole request.

ctx.signal is an AbortSignal for cancellation/disconnect. Pass it to upstream fetch/provider calls and clean up resources in finally. Cancellation only stops work that observes the signal. Middleware-added context fields are unknown until narrowed. For exact fields, read node_modules/heliumts/dist/server/context.d.ts; the public type is HeliumContext, not MethodContext or getRequestContext.

### Call a validated method from a page

This page uses the `greet` method from the validated-method guide. Define it first, then run `npx helium typegen` if the development server is stopped.

```tsx file=src/pages/index.tsx
import { useFetch } from "heliumts/client";
import { greet } from "../rpc.generated";

export default function Home() {
    const { data, isLoading, error } = useFetch(greet, { name: "Helium" });
    if (isLoading) return <p>Loading...</p>;
    if (error) return <p role="alert">{error}</p>;
    return <h1>{data?.message}</h1>;
}
```

## Choose one operation

### Read and cache data

useFetch(method, args) reads and caches. Required method arguments must be provided. For an argumentless method, useFetch(method) is valid. Use enabled: false to postpone a valid request.
### Mutate and invalidate data

useCall(method, options) mutates. call(args) returns the inferred result; onSuccess receives that same type. Failed calls set error state and reject, so catch the promise in event handlers. For ordinary forms, submit(args) returns a handled outcome: { status: "success", data }, { status: "error", error: RpcError }, or { status: "busy" }. It synchronously suppresses another submission while any call from this hook is pending, so the form needs no extra ref lock or rejection catch. isCalling/error still drive the UI. Busy performs no request or callbacks. This is per hook, not cross-component deduplication or server idempotency; call remains concurrent/rejecting. A submission error can also come from a callback after a committed write, so it does not prove rollback. Invalidation starts the existing eventual refresh; submit does not await related reads.

Invalidate every related read after success. For a detail edit that changes a title shown in a list, pass both references in `useCall(saveArticle, { invalidate: [getArticle, listArticles] })`. Invalidating only `getArticle` leaves a cached list stale when the user navigates back. Include related filtered lists and summary reads affected by the change. Use the returned result for immediate feedback when needed. Invalidation refetches cached reads.

### Edit fetched data without a synchronization effect

Pass a loaded article into this component. The app must already define getArticle({ id }), listArticles() and saveArticle({ id, title }) with server-side validation and authorization. The detail parent should show its loading, error and not-found states before rendering the editor.

```tsx file=src/components/ArticleEditor.tsx
import { useState, type FormEvent } from "react";
import { useCall } from "heliumts/client";
import { getArticle, listArticles, saveArticle } from "../rpc.generated";

type Article = { id: string; title: string };

export default function ArticleEditor({ article }: { article: Article }) {
    const save = useCall(saveArticle, { invalidate: [getArticle, listArticles] });
    const [draft, setDraft] = useState<Article | null>(null);
    const title = draft?.id === article.id ? draft.title : article.title;

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const outcome = await save.submit({ id: article.id, title });
        if (outcome.status === "success") setDraft(null);
    }

    return <form onSubmit={submit}>
        <label>Title <input value={title} onChange={(event) => setDraft({ id: article.id, title: event.currentTarget.value })} disabled={save.isCalling} required /></label>
        {save.error && <p role="alert">{save.error}</p>}
        <button type="submit" disabled={save.isCalling}>Save</button>
    </form>;
}
```

The displayed title comes from the current record until the user edits it. A draft is scoped to its record ID, so changing records does not display the previous record's draft. This avoids copying fetched data into state in a useEffect. Clear the draft only after a successful save; retain it when saving fails. The two invalidations refresh both the detail and its list.

### Consume an HTTP stream

useStreaming(method) consumes an AsyncIterable method over HTTP with length-prefixed MessagePack frames. Unary hooks reject streaming methods at compile time. Keep cancellation and server abort handling intact.
### Choose an explicit HTTP endpoint

defineHTTPRequest is for explicit HTTP endpoints, webhooks and integrations. Do not replace ordinary RPC with hand-written transport glue unless the task requires it.

## Routing and navigation

### Navigate with file routes

Put pages in src/pages: index.tsx maps to /, articles/index.tsx to /articles, and articles/[id].tsx to /articles/:id. Parenthesized route groups do not appear in the URL. Use Link from heliumts/client for links and useRouter inside the AppRouter tree for navigation and route state.

router.params.id holds a dynamic parameter (string or string[]); narrow it before using it as a method argument. router.push(href) adds a history entry, while router.replace(href) replaces the current entry. Use Redirect for declarative redirects rather than navigating during render. For exact signatures, read node_modules/heliumts/dist/client/Router.d.ts.

### Read and update query parameters

Use useRouter().searchParams, a URLSearchParams object. There is no separate useSearchParams export. Clone the current parameters before updating them, then navigate with push or replace; mutating the current object alone does not navigate.

```tsx file=src/components/ArticleFilters.tsx
import { useRouter } from "heliumts/client";

export default function ArticleFilters() {
    const router = useRouter();
    const status = router.searchParams.get("status") ?? "all";

    function showOpen() {
        const next = new URLSearchParams(router.searchParams);
        next.set("status", "open");
        router.replace(`${router.path}?${next.toString()}`, { scrollToTop: false });
    }

    return <button type="button" onClick={showOpen}>Show open (current: {status})</button>;
}
```

This preserves unrelated query parameters and replaces the URL without adding a history entry. Validate query values against the app's allowed values before passing them to RPC methods; query strings are untrusted input.

## Rendering and security

### Choose a rendering mode

Pages render on the client unless their file starts with "use ssr" or "use ssg". SSR and SSG adapters expose the same client hook shapes but do not perform browser RPC during rendering. Use the documented server-side props and static props mechanisms for initial data, not a client fetch in server render. A shared adapter does not make browser-only APIs available on the server.

### Preserve application security

Keep rate limits, input-size limits, origin checks, authorization, output escaping and cancellation. Do not send secrets or private user data to the browser. See the focused routing, SSR, SSG, middleware and streaming guides only when the task needs them.

## Measuring AI efficiency

### Measure successful agent tasks

HeliumTS reduces explicit client/server wiring. Source length is not total AI cost. Compare successful matched tasks and count input context, output, tool results, retries and failures with fixed models and versions. Do not claim HeliumTS uses fewer tokens than every framework without reproducible evidence.
