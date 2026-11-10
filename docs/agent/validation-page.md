# Call a validated method from a page

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Define one validated method](./validation.md), [Keep imports at the right boundary](./imports.md)

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

Related: [Read and cache data](./operations.md).
