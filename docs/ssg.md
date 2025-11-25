# Static Site Generation (SSG)

## Overview

HeliumJS supports Static Site Generation (SSG) through pre-rendering pages at build time. SSG allows you to generate static HTML files for pages that don't require server-side rendering or dynamic data, improving performance and reducing server load.

## Quick Start

To enable SSG for a page, simply add a `"use ssg";` directive at the top of your page component:

```tsx
"use ssg";

import React from "react";

export default function AboutPage() {
    return (
        <div>
            <h1>About Us</h1>
            <p>This page is statically generated at build time.</p>
        </div>
    );
}
```

That's it! During `helium build`, this page will be pre-rendered to a static HTML file.

## How It Works

When you run `helium build`:

1. **Page Scanning**: Helium scans the `src/pages` directory for files with the `"use ssg";` directive
2. **Validation**: Each page is validated for SSG compatibility (checks for hooks, client imports, etc.)
3. **Pre-rendering**: A Vite SSR server is created to render each page to static HTML
4. **File Generation**: Static HTML files are generated in the `dist` directory

### Generated Files

SSG pages are output with the following structure:

```
dist/
├── index.html          # src/pages/index.tsx with "use ssg"
├── about.html          # src/pages/about.tsx with "use ssg"
├── contact.html        # src/pages/contact.tsx with "use ssg"
└── ...other static pages
```

## File Structure Examples

### Basic Static Page

```tsx
"use ssg";

export default function ContactPage() {
    return (
        <div>
            <h1>Contact Us</h1>
            <p>Email: hello@example.com</p>
        </div>
    );
}
```

Output: `dist/contact.html`

### Page with Layouts

SSG works seamlessly with layouts:

```tsx
// src/pages/_layout.tsx
export default function Layout({ children }: { children: React.ReactNode }) {
    return (
        <div>
            <header>Header</header>
            <main>{children}</main>
            <footer>Footer</footer>
        </div>
    );
}
```

```tsx
// src/pages/about.tsx
"use ssg";

export default function AboutPage() {
    return <div>About content</div>;
}
```

The generated HTML will include the layout wrapper.

### Route Groups

SSG respects route groups and strips them from URLs:

```
src/pages/
├── (marketing)/
│   ├── _layout.tsx      # Marketing layout
│   ├── index.tsx        # "use ssg" → /index.html
│   └── about.tsx        # "use ssg" → /about.html
└── (app)/
    └── dashboard.tsx    # No "use ssg" → client-side rendered
```

See [Route Groups](./route-groups.md) for more details.

## Limitations & Warnings

### Current Limitations

1. **Dynamic Routes Not Supported**: Pages with parameters like `[id].tsx` or `[...slug].tsx` cannot be pre-rendered yet
    - Future versions will support static path generation

2. **No Real-Time Data**: SSG pages are generated at build time and won't reflect runtime data
    - Consider using client-side data fetching if needed

3. **Build-Time Only**: Pages are rendered once during build, not on each request

### Compatibility Warnings

During build, Helium validates SSG pages and displays warnings for patterns that may cause issues:

#### React Hooks Warning

```tsx
"use ssg";

import { useState } from "react";

export default function Page() {
    const [count, setCount] = useState(0); // ⚠️ Warning!
    return <div>{count}</div>;
}
```

**Warning:** `Page uses React hooks which may cause hydration issues`

**What it means:** While the page will render statically, hooks like `useState` require client-side hydration. The static HTML won't include the dynamic state.

**Solutions:**

- Remove hooks if the page is truly static
- Use SSG for initial render and let hooks work on the client side
- Remove `"use ssg";` if the page needs to be fully dynamic

#### Client Imports Warning

```tsx
"use ssg";

import { useFetch, useCall } from "helium/client"; // ⚠️ Warning!

export default function Page() {
    const { data } = useFetch(getTasks); // Won't work in SSG
    return <div>...</div>;
}
```

**Warning:** `Page imports from 'helium/client' which requires client-side execution`

**What it means:** Client-side features like `useFetch`, `useCall`, and `useRouter` require a WebSocket connection and won't work during static generation.

**Solutions:**

- Remove client-side data fetching from SSG pages
- Use static data or fetch data at build time (custom build script)
- Remove `"use ssg";` if the page needs dynamic data

#### Server Imports Warning

```tsx
"use ssg";

import { getTasks } from "helium/server"; // ⚠️ Warning!

export default function Page() {
    // Can't call server methods during SSG
    return <div>...</div>;
}
```

**Warning:** `Page imports from 'helium/server' which may cause runtime issues`

**What it means:** Server-side methods aren't callable during static generation.

**Solutions:**

- Remove server imports from SSG pages
- Fetch data at build time using a custom build script
- Remove `"use ssg";` if the page needs server-side data

### Layout Warnings

Helium also validates layouts for SSG pages:

```
⚠️  SSG Warning: The following pages may not be fully static:
  pages/(marketing)/index.tsx:
    - Layout pages/(marketing)/_layout.tsx has issues:
      └─ Page uses React hooks which may cause hydration issues
```

This means a layout wrapping your SSG page has compatibility issues. The same solutions apply.

## Build Output

During build, Helium shows detailed information about SSG pages:

```
Generating 3 static page(s) for SSG...
  index.html                               2.45 kB │ gzip:    1.12 kB
  about.html                               3.21 kB │ gzip:    1.54 kB
  contact.html                             2.87 kB │ gzip:    1.33 kB
```

### Build Failures

If a page fails to render (e.g., timeout or error), Helium generates a fallback HTML file:

```
  ✗ pages/problematic.tsx - Rendering timeout after 10000ms - page may contain hooks or async operations
```

The fallback HTML contains an empty `<div id="root">` that allows the client to hydrate and render the page normally.

## SSG with Router Features

During SSG, router features are mocked to allow pages to render:

### useRouter Hook

```tsx
"use ssg";

import { useRouter } from "helium/client";

export default function Page() {
    const router = useRouter();

    // During SSG:
    // - router.path = current page's URL path
    // - router.params = {}
    // - router.searchParams = new URLSearchParams()
    // - router.push/replace = no-op functions

    return <div>Current path: {router.path}</div>;
}
```

The `path` reflects the page being generated (e.g., `/about` for `about.tsx`).

### Link Component

```tsx
"use ssg";

import { Link } from "helium/client";

export default function Page() {
    return (
        <div>
            <Link href="/about">About</Link> {/* Renders as <a> tag */}
        </div>
    );
}
```

Links render as standard `<a>` tags in the static HTML.

### useFetch and useCall

```tsx
"use ssg";

import { useFetch } from "helium/client";
import { getTasks } from "helium/server";

export default function Page() {
    const { data } = useFetch(getTasks);

    // ⚠️ Warning during build
    // data will be null in static HTML

    return <div>{data ? "Has data" : "No data"}</div>;
}
```

These hooks return null/empty values during SSG and will log warnings.

## Advanced Usage

### Conditional SSG

Use environment variables to enable SSG conditionally:

```tsx
// Only enable SSG in production builds
"use ssg";

export default function Page() {
    return <div>Content</div>;
}
```

Or remove the directive programmatically based on your build configuration.

### Mixed Static and Dynamic

You can mix SSG and dynamic pages in the same application:

```
src/pages/
├── index.tsx              # "use ssg" - Static homepage
├── about.tsx              # "use ssg" - Static about page
├── blog/
│   ├── index.tsx          # "use ssg" - Static blog list
│   └── [slug].tsx         # Dynamic blog posts (no SSG yet)
└── dashboard/
    └── index.tsx          # Dynamic dashboard (no SSG)
```

### Hybrid Rendering

Since SSG pages include client-side JavaScript, you can create hybrid pages:

```tsx
"use ssg";

import { useState, useEffect } from "react";

export default function HybridPage() {
    const [clientData, setClientData] = useState<string | null>(null);

    // Static content rendered at build time
    const staticContent = "This is static content";

    // Dynamic content loaded on the client
    useEffect(() => {
        fetch("/api/data")
            .then((res) => res.json())
            .then((data) => setClientData(data));
    }, []);

    return (
        <div>
            <h1>{staticContent}</h1>
            {clientData && <p>Dynamic: {clientData}</p>}
        </div>
    );
}
```

The page renders statically with `staticContent`, then hydrates on the client and fetches dynamic data.

## Render Timeout

Pages have a 10-second timeout for rendering. If rendering takes longer, the build will fail for that page:

```
✗ pages/slow-page.tsx - Rendering timeout after 10000ms
```

**Common causes:**

- Async operations in component body
- Infinite loops
- Heavy computations
- Network requests during render

**Solutions:**

- Move async operations to `useEffect` (client-side only)
- Optimize heavy computations
- Remove blocking operations from render

## Deployment

Static pages work out of the box with any hosting platform:

### Static Hosting (Netlify, Vercel, etc.)

Deploy the `dist` directory as a static site. The server handles non-SSG pages dynamically.

### Hybrid Deployment

Helium applications are hybrid by default:

- SSG pages are served as static HTML
- Non-SSG pages are rendered dynamically
- The same server handles both

No special configuration needed!

## Best Practices

1. **Use SSG for static content**: Marketing pages, about pages, documentation
2. **Don't use SSG for user-specific content**: Dashboards, profiles, admin panels
3. **Avoid hooks in truly static pages**: Keep SSG pages simple
4. **Test build output**: Check generated HTML files are correct
5. **Monitor build warnings**: Address compatibility issues
6. **Consider hybrid rendering**: Use SSG for shell, fetch data client-side
7. **Keep pages simple**: Complex pages are better suited for CSR or SSR
8. **Use layouts wisely**: Ensure layouts are SSG-compatible

## Troubleshooting

### Page not being generated

**Symptoms:**

- Page not appearing in build output
- No HTML file in `dist` directory

**Solutions:**

1. Verify `"use ssg";` directive is at the top of the file
2. Check for syntax errors in the page component
3. Ensure the file extension is `.tsx`, `.jsx`, `.ts`, or `.js`
4. Check build logs for errors

### Build timeout

**Symptoms:**

- Error: "Rendering timeout after 10000ms"
- Page not generated

**Solutions:**

1. Remove async operations from component body
2. Move data fetching to `useEffect` (client-side)
3. Simplify component logic
4. Check for infinite loops or blocking operations

### Hydration mismatch

**Symptoms:**

- Console warnings about hydration
- Content flashing or changing after page load

**Solutions:**

1. Avoid using `Date.now()` or `Math.random()` in render
2. Ensure server and client render the same content
3. Move dynamic content to `useEffect`
4. Use `suppressHydrationWarning` for legitimate mismatches

### Missing styles

**Symptoms:**

- Static HTML has no styles
- Page looks unstyled initially

**Solutions:**

1. Ensure CSS is imported in your components
2. Check that Vite's CSS processing is working
3. Verify style tags are in the HTML template
4. Consider using CSS-in-JS with SSR support

## Future Enhancements

Planned features for future releases:

- **Dynamic Route SSG**: Pre-render pages with dynamic parameters
- **Incremental Static Regeneration (ISR)**: Re-generate pages on demand
- **Build-time Data Fetching**: Fetch data during build and inject into pages
- **Custom SSG Plugins**: Extend SSG with custom rendering logic
- **Partial Pre-rendering**: Pre-render above-the-fold content only

## Related Documentation

- [Route Groups](./route-groups.md) - Organize pages with route groups
- [Routing](./routing.md) - File-based routing system
- [Production Deployment](./production-deployment.md) - Deploy your application
