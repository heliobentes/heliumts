# Choose an explicit HTTP endpoint

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Keep imports at the right boundary](./imports.md), [Place discoverable server files](./server-files.md)

defineHTTPRequest is for explicit HTTP endpoints, webhooks and integrations. Do not replace ordinary RPC with hand-written transport glue unless the task requires it.

Related: [Preserve application security](./security.md).
