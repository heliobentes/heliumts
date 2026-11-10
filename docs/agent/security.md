# Preserve application security

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: None beyond an installed HeliumTS app.

Keep rate limits, input-size limits, origin checks, authorization, output escaping and cancellation. Do not send secrets or private user data to the browser. See the focused routing, SSR, SSG, middleware and streaming guides only when the task needs them.

Related: [Understand input parser behavior](./input-validation.md), [Choose a rendering mode](./rendering.md).
