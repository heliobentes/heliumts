# Static Site Generation (SSG) in Helium

Helium supports Static Site Generation (SSG) to improve SEO and initial page load performance. You can mark any page for static generation by adding the `"use ssg";` directive at the top of the file.

## Usage

Simply add `"use ssg";` as the first line of your page component:

```tsx
"use ssg";

export default function AboutPage() {
    return (
        <div>
            <h1>About Us</h1>
            <p>This page is statically generated at build time for better SEO!</p>
        </div>
    );
}
```

## How It Works

1. During `helium build`, the Vite plugin scans all pages in `src/pages/`
2. Pages with the `"use ssg";` directive are identified
3. For each SSG page, a static HTML file is generated in the `dist/` directory
4. The HTML includes all your bundled JavaScript and CSS, so the page still hydrates into a fully interactive React app

## Generated Files

SSG pages follow standard URL conventions:

- `src/pages/about.tsx` with `"use ssg";` → `dist/about/index.html`
- `src/pages/blog/post.tsx` with `"use ssg";` → `dist/blog/post/index.html`
- `src/pages/index.tsx` with `"use ssg";` → `dist/index.html` (overwrites the default)

## Current Limitations

- **Static routes only**: Dynamic routes like `[id].tsx` or `[...slug].tsx` are not yet supported
- **Client-side hydration**: The static HTML is a shell that gets hydrated by React on the client
- **No data fetching**: The current implementation doesn't pre-render data from `useFetch` or server functions

## Benefits

✅ **Improved SEO**: Search engines can crawl your pages immediately  
✅ **Faster First Paint**: Users see content before JavaScript loads  
✅ **Better UX**: Reduced time to first meaningful paint  
✅ **No API needed**: Unlike `getStaticProps`, just add one directive

## Example

```tsx
// src/pages/pricing.tsx
"use ssg";

export default function PricingPage() {
    return (
        <div>
            <h1>Pricing</h1>
            <div className="pricing-cards">
                <div className="card">
                    <h2>Free</h2>
                    <p>$0/month</p>
                </div>
                <div className="card">
                    <h2>Pro</h2>
                    <p>$29/month</p>
                </div>
            </div>
        </div>
    );
}
```

After running `helium build`, you'll have a `dist/pricing/index.html` file that can be served directly by your web server or CDN.

## Future Enhancements

The following features are planned for future versions:

- **Dynamic routes**: Support for `[id].tsx` with `getStaticPaths`-like functionality
- **Data pre-rendering**: Execute server functions at build time to pre-render data
- **Incremental Static Regeneration (ISR)**: Rebuild pages on-demand
- **Partial hydration**: Only hydrate interactive components ("islands architecture")
