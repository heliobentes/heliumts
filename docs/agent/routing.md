# Navigate with file routes

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Keep imports at the right boundary](./imports.md)

Put pages in src/pages: index.tsx maps to /, articles/index.tsx to /articles, and articles/[id].tsx to /articles/:id. Parenthesized route groups do not appear in the URL. Use Link from heliumts/client for links and useRouter inside the AppRouter tree for navigation and route state.

router.params.id holds a dynamic parameter (string or string[]); narrow it before using it as a method argument. router.push(href) adds a history entry, while router.replace(href) replaces the current entry. Use Redirect for declarative redirects rather than navigating during render. For exact signatures, read node_modules/heliumts/dist/client/Router.d.ts.

Related: [Read and update query parameters](./query-params.md), [Find installed public API types](./api-reference.md).
