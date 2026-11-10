# Define one validated method

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Keep imports at the right boundary](./imports.md), [Place discoverable server files](./server-files.md)

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

Related: [Understand input parser behavior](./input-validation.md), [Call a validated method from a page](./validation-page.md).
