# Place discoverable server files

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Keep imports at the right boundary](./imports.md)

Put pages under src/pages, methods under src/server and middleware in src/server/_middleware.ts. Start with the explicit exported defineMethod form below; discovery also supports import aliases, typed declarations and relative re-exports within src/server. Arbitrary wrapper factories, computed calls and tsconfig path aliases are not inferred; use an explicit defineMethod export at the discovery boundary.

Related: [Define one validated method](./validation.md), [Verify an application](./verify.md).
