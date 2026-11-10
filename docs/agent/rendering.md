# Choose a rendering mode

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Keep imports at the right boundary](./imports.md)

Pages render on the client unless their file starts with "use ssr" or "use ssg". SSR and SSG adapters expose the same client hook shapes but do not perform browser RPC during rendering. Use the documented server-side props and static props mechanisms for initial data, not a client fetch in server render. A shared adapter does not make browser-only APIs available on the server.

Related: [Preserve application security](./security.md).
