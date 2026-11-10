# Read and cache data

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Call a validated method from a page](./validation-page.md)

useFetch(method, args) reads and caches. Required method arguments must be provided. For an argumentless method, useFetch(method) is valid. Use enabled: false to postpone a valid request.

Related: [Mutate and invalidate data](./mutations.md), [Consume an HTTP stream](./streaming.md).
