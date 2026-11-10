# Consume an HTTP stream

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Keep imports at the right boundary](./imports.md), [Place discoverable server files](./server-files.md)

useStreaming(method) consumes an AsyncIterable method over HTTP with length-prefixed MessagePack frames. Unary hooks reject streaming methods at compile time. Keep cancellation and server abort handling intact.

Related: [Choose an explicit HTTP endpoint](./http-handlers.md), [Preserve application security](./security.md).
