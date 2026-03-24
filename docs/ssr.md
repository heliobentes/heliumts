# Server-Side Rendering (SSR)

## Overview

HeliumTS supports Server-Side Rendering (SSR) for pages that need to serve fully rendered HTML to search engines and social media crawlers. Unlike [Static Site Generation (SSG)](./ssg.md) which produces HTML once at build time, SSR renders each request on the server and can return personalized content.

## Quick Start

Add the `"use ssr"` directive at the top of any page file:

```tsx
"use ssr";

export default function DashboardPage() {
    return <h1>Dashboard</h1>;
}
```

That's it. On every request for `/dashboard`, HeliumTS renders the component on the server, injects the markup into `index.html`, and sends the complete HTML to the browser. React then hydrates the page client-side.

## Rendering Modes Comparison

| Feature                  | SSR                       | SSG           | SPA (default)                    |
| ------------------------ | ------------------------- | ------------- | -------------------------------- |
| HTML on first load       | ✅ Per-request            | ✅ Build-time | ❌ Empty `<div id="root">`       |
| Dynamic per-request data | ✅                        | ❌            | ✅ (client-only)                 |
| Server-side props        | ✅ `getServerSideProps`   | ❌            | ❌                               |
| Auth-protected pages     | ✅ (skip guard on server) | ❌            | ✅                               |
| Build step required      | ❌                        | ✅            | ❌                               |
| Suitable for SEO         | ✅                        | ✅            | ⚠️ Requires crawler JS execution |

## Server-Side Props

To fetch data on the server for each request, export a `getServerSideProps` function from the same page file **or** from a sidecar `page.server.ts` file.

### Inline export (NOT recommended)

```tsx
"use ssr";

import type { GetServerSideProps } from "heliumts/server";

export const getServerSideProps: GetServerSideProps = async (req) => {
    const user = await db.users.findById(req.params.id);
    return { user };
};

export default function ProfilePage({ user }: { user: { name: string } }) {
    return <h1>Hello, {user.name}</h1>;
}
```

### Sidecar file (recommended)

Using a `page.server.ts` sidecar avoids mixing server and client code in the same file, which prevents React Fast Refresh warnings:

```
src/pages/
└── profile.tsx          # Page component ("use ssr")
└── profile.server.ts    # Server-side props
```

```ts
// src/pages/profile.server.ts
import type { GetServerSideProps } from "heliumts/server";

export const getServerSideProps: GetServerSideProps = async (req, ctx) => {
    const user = await db.users.findById(req.params.id as string);
    return { user };
};
```

```tsx
// src/pages/profile.tsx
"use ssr";

export default function ProfilePage({ user }: { user: { name: string } }) {
    return <h1>Hello, {user.name}</h1>;
}
```

### `GetServerSideProps` type

```ts
import type { GetServerSideProps } from "heliumts/server";
```

The handler receives two arguments:

| Argument | Type                     | Description                                         |
| -------- | ------------------------ | --------------------------------------------------- |
| `req`    | `ServerSidePropsRequest` | Request metadata                                    |
| `ctx`    | `HeliumContext`          | Server context (IP, headers, raw `IncomingMessage`) |

`ServerSidePropsRequest` fields:

| Field     | Type                                              | Description                 |
| --------- | ------------------------------------------------- | --------------------------- |
| `method`  | `string`                                          | HTTP method (`"GET"`, etc.) |
| `path`    | `string`                                          | Request pathname            |
| `headers` | `Record<string, string \| string[] \| undefined>` | Request headers             |
| `query`   | `Record<string, string>`                          | URL query parameters        |
| `params`  | `Record<string, string \| string[]>`              | Dynamic route parameters    |

The function can return `null`, `undefined`, a plain object, or a redirect result.

### Redirects from SSR

You can redirect directly from `getServerSideProps`:

```ts
import type { GetServerSideProps } from "heliumts/server";

export const getServerSideProps: GetServerSideProps = async (req, ctx) => {
    const accountStatus = await billing.getStatus(ctx.req.headers.authorization);

    if (accountStatus === "overdue") {
        return {
            redirect: {
                destination: "/billing/overdue",
                statusCode: 307,
                replace: true,
            },
        };
    }

    return { accountStatus };
};
```

Redirect options:

| Field         | Type                          | Description                                            |
| ------------- | ----------------------------- | ------------------------------------------------------ |
| `destination` | `string`                      | Target URL/path (required)                             |
| `statusCode`  | `301 \| 302 \| 303 \| 307 \| 308` | Optional HTTP status for server redirects              |
| `permanent`   | `boolean`                     | Shortcut for defaulting to `308` when no status is set |
| `replace`     | `boolean`                     | Client-side navigation history behavior (default `true`) |

Behavior:

- First page load (server-rendered HTML): Helium sends an HTTP redirect with `Location`.
- Client-side navigation (`/__helium__/page-props`): Helium performs a client redirect using the same destination.

## Layouts with SSR

Layouts work the same way with SSR pages as with regular pages. However, layouts that contain auth guards or other logic that returns `null` during SSR will produce an empty server render.

Use the `isSSR()` utility to skip client-only logic while still rendering the full provider tree on the server:

```tsx
// src/pages/(app)/_layout.tsx
import { isSSR, useRouter } from "heliumts/client";
import { useEffect } from "react";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { isPending, data } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (!data?.session && !isPending) {
            router.push("/login");
        }
    }, [data, isPending, router]);

    // Skip the auth guard during SSR so providers still wrap the page for rendering.
    // Client-side hydration will enforce the redirect if needed.
    if (!isSSR()) {
        if (isPending) return null;
        if (!data?.session) return null;
    }

    return (
        <SidebarProvider>
            <main>{children}</main>
        </SidebarProvider>
    );
}
```

### `isSSR()`

```ts
import { isSSR } from "heliumts/client";
```

Returns `true` when running on the server during SSR, `false` in the browser. Equivalent to `typeof window === "undefined"` but more readable and works correctly inside the Helium SSR stub environment.

## How SSR Works

1. **Directive scanning**: At dev/build time, Helium scans `src/pages` for files containing `"use ssr"`.
2. **Request intercept**: When the browser requests an SSR page, the server intercepts the HTML response.
3. **`getServerSideProps`**: If defined, the handler is called and its return value is merged into props.
4. **`renderToString`**: React renders the full component tree (layouts → page) to an HTML string.
5. **HTML injection**: The markup is injected into `<div id="root">` in `index.html`.
6. **Payload injection**: Props are serialised as `window.__HELIUM_SSR_DATA__` so the client can hydrate without a second fetch.
7. **Hydration**: In the browser, React calls `hydrateRoot` when SSR markup is detected, attaching event listeners without re-rendering.

## Client-Side Navigation

On subsequent navigations (after the first page load), HeliumTS fetches props via `GET /__helium__/page-props?path=<url>` and re-renders the page client-side — no full page reload is needed.

## Sidecar File Conventions

Helium automatically discovers sidecar server files for every SSR page. Supported extensions:

| Sidecar file      | On disk example                |
| ----------------- | ------------------------------ |
| `page.server.ts`  | `src/pages/profile.server.ts`  |
| `page.server.tsx` | `src/pages/profile.server.tsx` |
| `page.server.js`  | `src/pages/profile.server.js`  |
| `page.server.mts` | `src/pages/profile.server.mts` |

The sidecar must export `getServerSideProps`. Any other exports in the sidecar are ignored.

## Browser-Only Dependencies

If a page or its transitively imported modules access browser globals (`window`, `document`, `navigator`) at module evaluation time, SSR will fail with a runtime error and the page will fall back to the default SPA shell.

The most common cause is importing a browser-only library (e.g. a map library) directly at the top level. Move such imports inside `useEffect` or use a dynamic `import()`:

```tsx
"use ssr";

import { useEffect } from "react";

export default function MapPage() {
    useEffect(() => {
        // Browser-only: runs only on the client
        import("leaflet").then(({ default: L }) => {
            L.map("map-container");
        });
    }, []);

    return <div id="map-container" />;
}
```

## Limitations

- **Dynamic routes**: SSR works with dynamic routes (`[id].tsx`, `[...slug].tsx`) — params are available in `getServerSideProps` via `req.params`.
- **No streaming**: Rendering is synchronous (`renderToString`). React 18 streaming (`renderToPipeableStream`) is not yet supported.
- **Providers must be SSR-safe**: Any context provider rendered during SSR must not access browser globals at module evaluation time. Use `useEffect` for browser-side side effects.

## See Also

- [Static Site Generation (SSG)](./ssg.md) — for pages with content that doesn't change per-request
- [Routing](./routing.md) — file-based routing, layouts, and route groups
- [Context API](./context-api.md) — access request context inside server-side props
