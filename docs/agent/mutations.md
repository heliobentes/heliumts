# Mutate and invalidate data

HeliumTS 0.11.0 application reference. Use matching framework and scaffolder versions; see the upgrade notes when migrating from 0.10.2.

Prerequisites: [Call a validated method from a page](./validation-page.md)

useCall(method, options) mutates. call(args) returns the inferred result; onSuccess receives that same type. Failed calls set error state and reject, so catch the promise in event handlers. For ordinary forms, submit(args) returns a handled outcome: { status: "success", data }, { status: "error", error: RpcError }, or { status: "busy" }. It synchronously suppresses another submission while any call from this hook is pending, so the form needs no extra ref lock or rejection catch. isCalling/error still drive the UI. Busy performs no request or callbacks. This is per hook, not cross-component deduplication or server idempotency; call remains concurrent/rejecting. A submission error can also come from a callback after a committed write, so it does not prove rollback. Invalidation starts the existing eventual refresh; submit does not await related reads.

Invalidate every related read after success. For a detail edit that changes a title shown in a list, pass both references in `useCall(saveArticle, { invalidate: [getArticle, listArticles] })`. Invalidating only `getArticle` leaves a cached list stale when the user navigates back. Include related filtered lists and summary reads affected by the change. Use the returned result for immediate feedback when needed. Invalidation refetches cached reads.

Related: [Read and cache data](./operations.md).
