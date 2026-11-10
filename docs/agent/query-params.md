# Read and update query parameters

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Navigate with file routes](./routing.md)

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

Related: [Read and cache data](./operations.md), [Understand input parser behavior](./input-validation.md).
