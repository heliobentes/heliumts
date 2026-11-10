# Keep imports at the right boundary

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: None beyond an installed HeliumTS app.

- Import hooks, `Link` and router APIs from `heliumts/client`.
- Define server methods and middleware with primitives from `heliumts/server`.
- In browser application files, import RPC method references from the generated `src/rpc.generated.ts` module. For a page in `src/pages/`, use `../rpc.generated`. Pass the reference to a client hook or call helper to infer the method's arguments and result.
- Never import src/server implementations directly into browser files. Keep credentials, database clients and authorization on the server.
- Generated server bundles use heliumts/internal for framework helpers; application code should not import this internal entry point. Older helper exports from heliumts/server remain compatible.
- Use heliumts/vite only in build configuration. The package root is a namespace convenience, not the preferred browser import.

When upgrading from 0.10.2, switch browser RPC imports from `heliumts/server` to your generated module, delete the old generated `src/types/heliumts-server.d.ts` if it exists, and run `npx helium check`.

Related: [Place discoverable server files](./server-files.md), [Call a validated method from a page](./validation-page.md).
