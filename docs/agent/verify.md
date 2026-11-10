# Verify an application

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Scaffold a minimal app](./scaffold.md)

In a new starter, run the single verification script:

```bash
npm run verify
```

It runs `check`, `lint`, then `build` once each and stops on the first failure. Fix that failure and rerun verify. Check generates `src/rpc.generated.ts`, validates discovery and checks every referenced TypeScript project. A separate typegen or typecheck invocation is unnecessary in this sequence. Keep runtime tests required by your task; production build and type checks do not replace them.

For an existing app without verify, run its supplied check, lint and production-build scripts. `helium check` itself remains generation plus TypeScript: it does not run app scripts. `helium typegen` is available for generation alone; dev and build also keep RPC references current. Treat the RPC module as generated output.

Use inspect/api only to answer a specific discovery question, before verification when needed; they are not extra verification stages.

Related: [Place discoverable server files](./server-files.md).
