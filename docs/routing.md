# Routing and useRouter

## Overview

HeliumJS uses file-based routing similar to Next.js Pages Router. Pages are automatically mapped to routes based on their file path in the `src/pages` directory. The framework provides a powerful routing system with support for dynamic routes, catch-all routes, layouts, and route groups.

## File-Based Routing

### Basic Routes

Files in `src/pages` are automatically mapped to routes:

```
src/pages/
├── index.tsx           → /
├── about.tsx           → /about
├── contact.tsx         → /contact
└── blog/
    ├── index.tsx       → /blog
    └── post.tsx        → /blog/post
```

### Dynamic Routes

Use square brackets `[param]` to create dynamic routes:

```
src/pages/
├── users/
│   └── [id].tsx        → /users/:id (matches /users/123, /users/abc, etc.)
├── blog/
│   └── [slug].tsx      → /blog/:slug
└── products/
    └── [category]/
        └── [id].tsx    → /products/:category/:id
```

**Example usage:**

```tsx
// src/pages/users/[id].tsx
import { useRouter } from "helium/client";

export default function UserPage() {
    const router = useRouter();
    const userId = router.params.id; // Get the dynamic parameter

    return <div>User ID: {userId}</div>;
}
```

### Catch-All Routes

Use `[...param]` to match any number of path segments:

```
src/pages/
└── docs/
    └── [...slug].tsx   → /docs/* (matches /docs/a, /docs/a/b/c, etc.)
```

**Example usage:**

```tsx
// src/pages/docs/[...slug].tsx
import { useRouter } from "helium/client";

export default function DocsPage() {
    const router = useRouter();
    const slug = router.params.slug; // Array of path segments

    return <div>Docs path: {Array.isArray(slug) ? slug.join("/") : slug}</div>;
}
```

### Index Routes

Files named `index.tsx` represent the root of their directory:

```
src/pages/
├── index.tsx           → /
├── blog/
│   ├── index.tsx       → /blog
│   └── post.tsx        → /blog/post
└── admin/
    └── index.tsx       → /admin
```

## Route Groups

Route groups allow you to organize pages without affecting URLs. Wrap folder names in parentheses:

```
src/pages/
├── (marketing)/
│   ├── _layout.tsx     # Layout for marketing pages
│   ├── index.tsx       → /
│   ├── about.tsx       → /about
│   └── pricing.tsx     → /pricing
├── (app)/
│   ├── _layout.tsx     # Layout for app pages
│   ├── dashboard.tsx   → /dashboard
│   └── settings.tsx    → /settings
└── (auth)/
    ├── _layout.tsx     # Layout for auth pages
    ├── login.tsx       → /login
    └── register.tsx    → /register
```

The route group folders `(marketing)`, `(app)`, and `(auth)` are **stripped from URLs** but allow you to:

- Organize related pages
- Apply different layouts per group
- Keep code organized by feature/domain

See [Route Groups](./route-groups.md) for detailed information.

## Layouts

Layouts allow you to share UI between pages. They wrap page components and can be nested.

### Root Layout

Create `_layout.tsx` at the root of `src/pages` to wrap **all pages**:

```tsx
// src/pages/_layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <header>Global Header</header>
            <main>{children}</main>
            <footer>Global Footer</footer>
        </div>
    );
}
```

### Group Layouts

Create `_layout.tsx` inside route groups to wrap **only pages in that group**:

```tsx
// src/pages/(app)/_layout.tsx
export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="app-layout">
            <nav>App Navigation</nav>
            <div className="content">{children}</div>
        </div>
    );
}
```

### Nested Layouts

Layouts can be nested in subdirectories:

```
src/pages/
├── _layout.tsx                    # RootLayout - all pages
├── (app)/
│   ├── _layout.tsx                # AppLayout - (app) pages only
│   ├── dashboard.tsx              # [RootLayout → AppLayout]
│   └── settings/
│       ├── _layout.tsx            # SettingsLayout - settings pages only
│       └── profile.tsx            # [RootLayout → AppLayout → SettingsLayout]
```

**Rendering order:** Outer to inner (Root → Group → Nested)

```tsx
<RootLayout>
    <AppLayout>
        <SettingsLayout>
            <ProfilePage />
        </SettingsLayout>
    </AppLayout>
</RootLayout>
```

See [Route Groups - Layout Hierarchy](./route-groups.md#layout-hierarchy) for more details.

## Navigation

### Link Component

Use the `Link` component for client-side navigation:

```tsx
import { Link } from "helium/client";

export default function Nav() {
    return (
        <nav>
            <Link href="/">Home</Link>
            <Link href="/about">About</Link>
            <Link href="/blog/my-post">Blog Post</Link>
        </nav>
    );
}
```

**Props:**

- `href` (string): Target URL
- `replace` (boolean): Use `history.replace` instead of `history.push`
- `prefetch` (boolean, default: `true`): Prefetch page on hover for faster navigation
- `scrollToTop` (boolean, default: `true`): Scroll to top of page after navigation
- Standard `<a>` tag props (className, onClick, etc.)

**Behavior:**

- Left-clicks are intercepted for SPA navigation
- Modifier keys (Ctrl, Cmd, Shift, Alt) preserve normal link behavior (open in new tab, etc.)
- Right-clicks and middle-clicks work normally
- **Automatic prefetching**: When users hover over or focus on a link, the page chunk is preloaded in the background for instant navigation

**Prefetching:**

Links automatically prefetch page chunks on hover and focus (keyboard navigation). This means when a user clicks a link, the page is often already loaded:

```tsx
// Prefetching enabled by default
<Link href="/heavy-page">Heavy Page</Link>

// Disable prefetching for specific links
<Link href="/settings" prefetch={false}>Settings</Link>

// Disable scroll-to-top (e.g., for in-page tab navigation)
<Link href="/settings/profile" scrollToTop={false}>Profile Tab</Link>
```

### Programmatic Navigation

Use the `useRouter` hook for programmatic navigation:

```tsx
import { useRouter } from "helium/client";

export default function LoginPage() {
    const router = useRouter();

    const handleLogin = async () => {
        // Perform login
        await login();

        // Navigate to dashboard
        router.push("/dashboard");
    };

    return <button onClick={handleLogin}>Login</button>;
}
```

## useRouter Hook

The `useRouter` hook provides access to routing information and navigation methods.

### Usage

```tsx
import { useRouter } from "helium/client";

export default function MyComponent() {
    const router = useRouter();

    // Access router properties
    console.log(router.path);
    console.log(router.params);
    console.log(router.searchParams);
    console.log(router.status);

    return <div>...</div>;
}
```

### Properties

#### `path` (string)

Current pathname (without query string):

```tsx
const router = useRouter();
console.log(router.path); // "/blog/my-post"
```

#### `params` (Record<string, string | string[]>)

Dynamic route parameters:

```tsx
// URL: /users/123
const router = useRouter();
console.log(router.params.id); // "123"

// URL: /docs/guide/getting-started
const router = useRouter();
console.log(router.params.slug); // ["guide", "getting-started"]
```

#### `searchParams` (URLSearchParams)

URL query parameters:

```tsx
// URL: /search?q=hello&page=2
const router = useRouter();
console.log(router.searchParams.get("q")); // "hello"
console.log(router.searchParams.get("page")); // "2"

// Get all values
const allParams = Object.fromEntries(router.searchParams);
console.log(allParams); // { q: "hello", page: "2" }
```

#### `status` (200 | 404)

Current route status:

```tsx
const router = useRouter();

if (router.status === 404) {
    return <div>Page not found</div>;
}

return <div>Content</div>;
```

#### `isNavigating` (boolean)

Indicates whether a navigation is currently in progress. This is useful for showing loading indicators during page transitions:

```tsx
const router = useRouter();

return (
    <div>
        {router.isNavigating && <LoadingSpinner />}
        <main>{/* page content */}</main>
    </div>
);
```

#### `isPending` (boolean)

Indicates when content is stale (React 18+ concurrent feature). This is true when React is rendering a new page in the background while still showing the old content:

```tsx
const router = useRouter();

return (
    <div style={{ opacity: router.isPending ? 0.7 : 1 }}>
        <main>{/* page content */}</main>
    </div>
);
```

### Methods

#### `push(href: string, options?: { scrollToTop?: boolean })`

Navigate to a new route (adds to history):

```tsx
const router = useRouter();

router.push("/about");
router.push("/users/123");
router.push("/search?q=hello");

// Navigate without scrolling to top
router.push("/settings/notifications", { scrollToTop: false });
```

#### `replace(href: string, options?: { scrollToTop?: boolean })`

Navigate to a new route (replaces current history entry):

```tsx
const router = useRouter();

// Replace current URL (no back button entry)
router.replace("/login");

// Replace without scrolling to top
router.replace("/dashboard?tab=analytics", { scrollToTop: false });
```

**Use cases:**

- Redirects after authentication
- Replacing temporary URLs
- Preventing back navigation to intermediate states
- Updating query params without scroll reset (with `scrollToTop: false`)

### Redirect Component

For declarative redirects, use the `Redirect` component instead of calling `router.push()` during render:

```tsx
import { Redirect } from "helium/client";

export default function OldDocsPage() {
    return <Redirect to="/docs/getting-started" />;
}
```

**Props:**

- `to` (string): Target URL
- `replace` (boolean, optional): Use `history.replace` instead of `history.push` (default: `false`)

**Why use Redirect?**

Calling `router.push()` directly during render is an anti-pattern in React that can cause issues. The `Redirect` component uses `useLayoutEffect` internally to ensure navigation happens after the component mounts but before paint, following React best practices and preventing issues with server-side rendering.

**Example use cases:**

```tsx
// Redirect index page to a default subpage
// src/pages/docs/index.tsx
import { Redirect } from "helium/client";

export default function DocsIndex() {
    return <Redirect to="/docs/getting-started" />;
}

// Redirect with replace (no history entry)
export default function OldPage() {
    return <Redirect to="/new-page" replace />;
}

// Conditional redirect
export default function ProtectedPage() {
    const isAuthenticated = useAuth();

    if (!isAuthenticated) {
        return <Redirect to="/login" />;
    }

    return <div>Protected content</div>;
}
```

#### `on(event: RouterEvent, listener: EventListener)`

Subscribe to router events. Returns an unsubscribe function:

```tsx
const router = useRouter();

useEffect(() => {
    // Listen to navigation events
    const unsubscribe = router.on("navigation", (event) => {
        console.log(`Navigated from ${event.from} to ${event.to}`);
    });

    // Cleanup
    return unsubscribe;
}, [router]);
```

**Event types:**

- `"navigation"`: Fires after navigation completes
- `"before-navigation"`: Fires before navigation (can be prevented)

**Event object:**

```typescript
{
    from: string;    // Previous path
    to: string;      // New path
    preventDefault?: () => void;  // Only for "before-navigation"
}
```

## Smooth Navigation Transitions

Helium provides built-in support for smooth page transitions using React 18+ concurrent features. This prevents UI freezing when navigating to heavy pages.

### useDeferredNavigation Hook

The `useDeferredNavigation` hook integrates `useDeferredValue` and `useTransition` with the router for smoother navigation:

```tsx
import { useDeferredNavigation } from "helium/client";

export default function Layout({ children }: { children: React.ReactNode }) {
    const { isStale, isPending, isTransitioning } = useDeferredNavigation();

    return <div style={{ opacity: isTransitioning ? 0.7 : 1, transition: "opacity 150ms" }}>{children}</div>;
}
```

**Returned values:**

- `path` (string): Current path being navigated to
- `deferredPath` (string): Deferred path (may lag behind during transitions)
- `isStale` (boolean): True when showing old content while new page renders
- `isPending` (boolean): True when a navigation transition is in progress
- `isTransitioning` (boolean): True when either navigating or showing stale content

### PageTransition Component

The `PageTransition` component handles all navigation transition complexity with a simple API:

```tsx
import { PageTransition } from "helium/client";

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <Header />
            <PageTransition loadingClassName="opacity-50 transition-opacity" fallback={<LoadingSpinner />}>
                {children}
            </PageTransition>
            <Footer />
        </div>
    );
}
```

**Props:**

- `children` (ReactNode): Content to wrap
- `loadingClassName` (string, optional): CSS class applied during transitions
- `loadingStyle` (CSSProperties, optional): Inline styles applied during transitions
- `fallback` (ReactNode, optional): Suspense fallback for lazy-loaded pages

**With inline styles:**

```tsx
<PageTransition loadingStyle={{ opacity: 0.6, transition: "opacity 150ms ease" }}>{children}</PageTransition>
```

**With Tailwind CSS:**

```tsx
<PageTransition loadingClassName="opacity-60 transition-opacity duration-150" fallback={<div className="animate-pulse">Loading...</div>}>
    {children}
</PageTransition>
```

### How It Works

1. **Lazy Loading**: Pages are automatically code-split and lazy-loaded
2. **Prefetching**: Link components prefetch pages on hover/focus
3. **Deferred Rendering**: React renders new pages in the background
4. **Visual Feedback**: Old content fades while new content loads
5. **No Blocking**: UI remains responsive during heavy page renders

### Router Events

#### Navigation Event

Fires after navigation completes:

```tsx
import { useRouter } from "helium/client";
import { useEffect } from "react";

export default function Analytics() {
    const router = useRouter();

    useEffect(() => {
        const unsubscribe = router.on("navigation", (event) => {
            // Track page view
            trackPageView(event.to);
        });

        return unsubscribe;
    }, [router]);

    return null;
}
```

#### Before Navigation Event

Fires before navigation (can be prevented):

```tsx
import { useRouter } from "helium/client";
import { useEffect } from "react";

export default function UnsavedChangesGuard() {
    const router = useRouter();
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    useEffect(() => {
        const unsubscribe = router.on("before-navigation", (event) => {
            if (hasUnsavedChanges) {
                const confirmed = window.confirm("You have unsaved changes. Do you want to leave?");

                if (!confirmed) {
                    event.preventDefault?.(); // Prevent navigation
                }
            }
        });

        return unsubscribe;
    }, [router, hasUnsavedChanges]);

    return <form>...</form>;
}
```

## Complete Examples

### Blog with Dynamic Routes

```tsx
// src/pages/blog/[slug].tsx
import { useRouter } from "helium/client";
import { useFetch } from "helium/client";
import { getBlogPost } from "helium/server";

export default function BlogPostPage() {
    const router = useRouter();
    const slug = router.params.slug as string;

    const { data: post, isLoading } = useFetch(getBlogPost, { slug });

    if (isLoading) return <div>Loading...</div>;
    if (!post) return <div>Post not found</div>;

    return (
        <article>
            <h1>{post.title}</h1>
            <div>{post.content}</div>
        </article>
    );
}
```

### Search with Query Parameters

```tsx
// src/pages/search.tsx
import { useRouter } from "helium/client";
import { useFetch } from "helium/client";
import { searchProducts } from "helium/server";

export default function SearchPage() {
    const router = useRouter();
    const query = router.searchParams.get("q") || "";

    const { data: results } = useFetch(searchProducts, { query });

    const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const q = formData.get("q");
        router.push(`/search?q=${q}`);
    };

    return (
        <div>
            <form onSubmit={handleSearch}>
                <input name="q" defaultValue={query} />
                <button type="submit">Search</button>
            </form>

            <div>
                {results?.map((product) => (
                    <div key={product.id}>{product.name}</div>
                ))}
            </div>
        </div>
    );
}
```

### Authentication Guard

```tsx
// src/pages/(app)/dashboard.tsx
import { Redirect } from "helium/client";

export default function DashboardPage() {
    const isAuthenticated = checkAuth(); // Your auth logic

    if (!isAuthenticated) {
        return <Redirect to="/login" replace />;
    }

    return <div>Dashboard content</div>;
}
```

### Breadcrumb Navigation

```tsx
// src/components/Breadcrumbs.tsx
import { useRouter } from "helium/client";
import { Link } from "helium/client";

export default function Breadcrumbs() {
    const router = useRouter();
    const pathSegments = router.path.split("/").filter(Boolean);

    return (
        <nav>
            <Link href="/">Home</Link>
            {pathSegments.map((segment, index) => {
                const href = "/" + pathSegments.slice(0, index + 1).join("/");
                return (
                    <span key={href}>
                        {" / "}
                        <Link href={href}>{segment}</Link>
                    </span>
                );
            })}
        </nav>
    );
}
```

### Page Transition Analytics

```tsx
// src/components/Analytics.tsx
import { useRouter } from "helium/client";
import { useEffect } from "react";

export default function Analytics() {
    const router = useRouter();

    useEffect(() => {
        // Track initial page view
        trackPageView(router.path);

        // Track subsequent navigations
        const unsubscribe = router.on("navigation", (event) => {
            trackPageView(event.to);
            trackNavigationTime(event.from, event.to);
        });

        return unsubscribe;
    }, [router]);

    return null;
}

function trackPageView(path: string) {
    console.log("Page view:", path);
    // Send to analytics service
}

function trackNavigationTime(from: string, to: string) {
    console.log(`Navigation: ${from} → ${to}`);
    // Track navigation performance
}
```

### Global Loading Indicator

```tsx
// src/components/NavigationLoader.tsx
import { useRouter } from "helium/client";

export default function NavigationLoader() {
    const router = useRouter();

    if (!router.isNavigating) {
        return null;
    }

    return (
        <div className="fixed top-0 left-0 right-0 z-50">
            <div className="h-1 bg-blue-500 animate-pulse" />
        </div>
    );
}

// Use in your root layout
// src/pages/_layout.tsx
import NavigationLoader from "../components/NavigationLoader";

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <NavigationLoader />
            <header>Global Header</header>
            <main>{children}</main>
            <footer>Global Footer</footer>
        </div>
    );
}
```

## Route Collision Detection

Helium automatically detects when multiple files resolve to the same URL:

```
❌ Route collision detected! Multiple files resolve to the same path "/":
   - /src/pages/index.tsx
   - /src/pages/(marketing)/index.tsx
Only the first file will be used.
```

**Common causes:**

- Multiple `index.tsx` files at the same level
- Same filename in different route groups
- Mixed grouped and non-grouped files

**Solution:** Use unique filenames or nest pages in subdirectories.

See [Route Groups - Route Collision Detection](./route-groups.md#route-collision-detection) for more details.

## Best Practices

1. **Use Link for internal navigation**: Enables SPA navigation and better performance
2. **Use router.replace for redirects**: Prevents unwanted back button entries
3. **Validate params**: Dynamic params are strings - validate and parse them
4. **Handle loading states**: Show loading UI while data fetches
5. **Use layouts wisely**: Share UI without duplication
6. **Organize with route groups**: Keep related pages together
7. **Subscribe to events carefully**: Always unsubscribe in cleanup
8. **Type your params**: Use TypeScript to type route parameters

## TypeScript Support

### Typing Route Params

```tsx
import { useRouter } from "helium/client";

type UserPageParams = {
    id: string;
};

export default function UserPage() {
    const router = useRouter();
    const { id } = router.params as UserPageParams;

    // id is typed as string
    return <div>User: {id}</div>;
}
```

### Typing Search Params

```tsx
import { useRouter } from "helium/client";

export default function SearchPage() {
    const router = useRouter();

    const query = router.searchParams.get("q") ?? "";
    const page = Number(router.searchParams.get("page") ?? "1");

    // query: string, page: number
    return (
        <div>
            Search: {query}, Page: {page}
        </div>
    );
}
```

## Troubleshooting

### useRouter throws "must be used inside <AppRouter>"

**Cause:** `useRouter` called outside the router context

**Solution:** Ensure your app is wrapped with `<AppRouter>`:

```tsx
// src/main.tsx
import { AppRouter } from "helium/client";

ReactDOM.createRoot(document.getElementById("root")!).render(<AppRouter>{/* Your app */}</AppRouter>);
```

### Dynamic params are undefined

**Cause:** Wrong param name or file structure

**Solution:** Ensure param name matches filename:

- File: `[id].tsx` → Param: `router.params.id`
- File: `[slug].tsx` → Param: `router.params.slug`

### Navigation not working

**Cause:** Using `<a>` instead of `<Link>`

**Solution:** Use `<Link>` for internal navigation:

```tsx
// ❌ Don't use <a> for internal links
<a href="/about">About</a>

// ✅ Use <Link>
<Link href="/about">About</Link>
```

### Route groups affecting URLs

**Cause:** Misunderstanding how route groups work

**Solution:** Route groups are **stripped from URLs**. They're for organization only.

## Related Documentation

- [Route Groups](./route-groups.md) - Detailed guide on route groups and layouts
- [SSG](./ssg.md) - Static site generation with routing
- [Context API](./context-api.md) - Access request context
- [RPC Methods](./README.md#rpc-remote-procedure-calls) - Fetch data in pages
