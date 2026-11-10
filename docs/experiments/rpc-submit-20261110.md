# RPC submit prototype — 2026-11-10

Implemented an additive `useCall.submit()` and completed the approved eight one-turn Sol6.1 calls: two repetitions per arm, each creating one real task-editor feature and then extending it with description. **All eight stages passed** static checks, the same-act duplicate-submission UI unit, all11actual production browser/RPC cases and source integrity. No replacement turns or evaluator amendments. All within-turn failures/self-corrections are counted.

## Result

Across these two small project chains per arm, prototype totals were6.69%lower, fresh input15.94%lower, output7.51%lower and generation+tool time9.32%lower. These are descriptive observations, not dollar-cost or general AI-efficiency guarantees. Creation used17.71%fewer total tokens; the later description change used12.72%MORE total tokens in aggregate and more in BOTH prototype repetitions. There is no later-change savings claim.

| Chain | Input | Cached input | Fresh input | Output | Total | Generation+tools s | Sum stage-to-validation s |
|---|---:|---:|---:|---:|---:|---:|---:|
| base-r1 | 390,299 | 323,584 | 66,715 | 3,856 | 394,155 | 109.19 | 128.03 |
| proto-r1 | 349,269 | 284,416 | 64,853 | 3,564 | 352,833 | 99.17 | 117.83 |
| proto-r2 | 378,143 | 302,592 | 75,551 | 3,454 | 381,597 | 94.75 | 113.45 |
| base-r2 | 389,214 | 288,896 | 100,318 | 3,732 | 392,946 | 104.67 | 124.07 |

Per-arm chain median (range), n=2: baseline393,550.5tokens (392,946–394,155),106.93generation seconds (104.67–109.19); prototype367,215tokens (352,833–381,597),96.96seconds (94.75–99.17). Actual8calls:1,521,531tokens =1,506,925input +14,606output;1,199,488cached input,307,437fresh. Reasoning is an output subset, not added again. Actual USD is unavailable under the ChatGPT subscription; no paid fallback or fabricated token-to-dollar conversion. Final quota98%used, no reached-limit indication.

## Every measured step

| Stage | Total tokens | Cached | Fresh input | Output | Generation s | To independent validation s |
|---|---:|---:|---:|---:|---:|---:|
| base-r1-s1 | 253,301 | 221,568 | 28,986 | 2,747 | 75.69 | 85.12 |
| base-r1-s2 | 140,854 | 102,016 | 37,729 | 1,109 | 33.50 | 42.90 |
| proto-r1-s1 | 181,742 | 151,552 | 27,742 | 2,448 | 66.10 | 75.35 |
| proto-r1-s2 | 171,091 | 132,864 | 37,111 | 1,116 | 33.07 | 42.48 |
| proto-r2-s1 | 231,480 | 183,552 | 45,375 | 2,553 | 67.97 | 77.30 |
| proto-r2-s2 | 150,117 | 119,040 | 30,176 | 901 | 26.78 | 36.14 |
| base-r2-s1 | 248,834 | 173,952 | 71,953 | 2,929 | 78.88 | 88.57 |
| base-r2-s2 | 144,112 | 114,944 | 28,365 | 803 | 25.79 | 35.50 |

Generation time includes all model/tool/static-check work inside its turn. Stage-to-validation wall includes candidate archival and independent static/UI/browser work, but excludes subsequent coordinator review. Per-turn setup totals10.63seconds; shared dependency merging, fixture/reference engineering and framework development were not separately timed. Coordinator model tokens are unexposed/excluded. Actual chain wall through final validation (including between-stage review/setup) was182.33/155.59/136.76/156.85seconds in the displayed chain order; summed stage intervals are not entire project elapsed. Details remain in CSV/JSON.

## Small API, visible logic

`useCall(method, { invalidate: [detailRead, listRead] })` now also returns `submit(args)`, resolving `{status:"success",data}`, `{status:"error",error:RpcError}` or `{status:"busy"}`. Required/optional argument inference remains intact. Same-hook pending calls synchronously suppress another submit before React rerenders. Busy has no request/callback/invalidation. Separate hooks remain independent; this is not server idempotency.

`call()` remains the concurrent/rejecting primitive with its existing callback behavior. Submit normalizes escaped errors without changing callbacks or awaiting related reads. A callback can fail after a committed server write; an error outcome does not prove rollback. Existing explicit invalidations start eventual refresh—no inferred dependency graph, fetch endpoints, query library or validation/auth/rate-limit/cancellation removal. SSR/SSG adapters expose the new shape with an explicit handled browser-only diagnostic; old call stubs are unchanged.

All four prototype stages actually used submit (including destructured calls). Both baseline apps used call +one local ref/try/catch/finally; all prototype UIs had zero such constructs. Explicit `[listTasks, getTask]` remained in EVERY stage. Final authored UI nonblank lines were101/119baseline and100/98prototype; authored server+UI totals151/168baseline and143/149prototype. These counts exclude generated RPC/types/tests/shared fixtures and are descriptive, not token-cost proxies. The helper removes pending/rejection plumbing, not field state or server validation.

Relative to the accepted dirty928-test baseline, exact delta is supplied in framework-incremental.patch: src/client/useCall.ts; src/vite/serverClientAdapter.ts; tests/client/useCall.submit.test.tsx; tests/client/rpcTypes.ts; tests/vite/serverClientAdapter.test.tsx; docs/agent-guide.md; docs/agent-start.md; generated mutation/editable-form topics. Existing unrelated changes and all memory experiment results were preserved. Public SubmitResult is exported through the existing client wildcard and was verified through the public API catalog.

## Correctness and visible UI

Framework build/typecheck/lint,937tests/72files, executable docs, packed API and built application smoke passed before trials. Baseline package/source were frozen BEFORE prototype edits/build; baseline declarations have no submit, prototype declarations do. Independent calibration passed BOTH packages and BOTH feature stages, including exact types and same-act UI. State-only/disabled guard mutant failed2writes vs1; weakened types failed; actual browser negatives caught missing list refresh, lost draft, auth bypass and skipped validation. No app was repaired by the coordinator.

Each measured stage passed11browser/native RPC checks: normal+narrow UI; visible loading; list/detail failure and retry; not-found without editor; same-form save failure/retry with preserved draft and no failed-write refresh; explicit detail+list success refresh; held-mutation duplicate counter; real auth/owner isolation; malformed/mixed-write atomic validation; SQLite persistence after server restart; served-client/server boundary. Protected storage/session fixtures were supplied equally; agents authored the two named feature files, not a whole auth/storage system. Step2 kept all old assertions while requiring description validation/preview.

Screenshots normal/narrow/loading/error/saved were captured; reference and actual prototype at360px were inspected. Capture-only resize/full-page artifacts were corrected BEFOREfreeze, with DOM proof Tasks once, one form, scrollY0 and width360; no application rendering changes or hidden assertions were introduced. The UI keeps labels/actions/state visible without introductory banners.

## Scope, controls and limitations

Sol6.1 medium, Standard default, subscription only; later explicit all-Sol instruction superseded older Luna preference. No memory in any arm; CLI global memory/multi-agent features disabled. Ordered baseline-r1 pair, prototype-r1 pair, prototype-r2 pair, baseline-r2 pair. Frozen53inputs verified unchanged; model plan/source archives and durable receipts retained after every turn. No concurrent generation/evaluation.

Step1 began from matched blank scaffolds with identical protected SQLite/session/control fixtures and installed tooling; framework package/docs/API treatment differed. Step2 continued its own authored source and append-only visible-event history, not hidden native resumed context. Four chains diverge legitimately after step1; these are TWO chains per arm, not eight independent observations. Cache/order/background host load and coordinator review delays are uncontrolled. Framework/reference/setup engineering is excluded from child task metrics, so this is not total development AI usage. The original cache-based environment was not clean-install certified; the separately labelled post-study reproduction below now records successful clean installs with transitive differences. The framework API adds no dependencies.

Recommendation: retain the small additive prototype as a useful form submission path, with existing call available for advanced cases. The local-plumbing reduction is demonstrated; broad generation savings and larger-app amortization remain unproven. Do not expand this into a query/dependency-inference abstraction based on this study.

## Artifacts

- [Turn CSV](/tmp/helium-sol-submit-study-20261110/reports/turns.csv), [chain CSV](/tmp/helium-sol-submit-study-20261110/reports/chains.csv), [full metrics](/tmp/helium-sol-submit-study-20261110/reports/results.json), [n=2 summary](/tmp/helium-sol-submit-study-20261110/reports/arm-summary.json).
- [Plumbing AST audit](/tmp/helium-sol-submit-study-20261110/reports/plumbing-audit.json), [trace audit](/tmp/helium-sol-submit-study-20261110/reports/trace-audit.json), [frozen integrity](/tmp/helium-sol-submit-study-20261110/reports/frozen-integrity.json).
- [Run instructions](/tmp/helium-sol-submit-study-20261110/deliverables/RUN.md), [source/packages/screenshots](/tmp/helium-sol-submit-study-20261110/deliverables), [independent calibration logs](/tmp/helium-sol-submit-study-20261110/deliverables/independent-review).
- Baseline/prototype freeze hashes and exact patch: ../baseline/ and ../prototype/. Earlier step source snapshots remain in ../reports/*-candidate.tar.gz; raw commands/usage are in ../harness/results/.

## Post-study clean reproduction follow-up

A bounded follow-up checked one extracted final app per arm (base-r1/proto-r1), without model calls or feature edits. **Both original lockfiles failed clean npm ci** with EUSAGE: missing nested json5/semver/lru-cache entries and inconsistent esbuild optional versions. This confirms the original clean-install limitation was material; original archives and measured metrics remain unchanged.

Separately labelled reproduction locks were generated using public npm metadata, exact recorded direct versions and the unchanged local framework tar. Both `npm ci --ignore-scripts`, build/types/lint, the1same-act UI unit and all11actual browser/RPC cases then passed. All non-lock files from the original source archives and all installed framework package file contents are byte-identical. This is a successful functional reproduction in a **different transitive environment**, not retrospective certification of the original lock or exact benchmark environment.

Per arm, installed package locations changed410→262:156removed,8added,39same-location version changes; direct versions match. Detailed deltas and logs are in [reproduction evidence](/tmp/helium-sol-submit-study-20261110/deliverables/reproduction/summary.json) and [version comparison](/tmp/helium-sol-submit-study-20261110/deliverables/reproduction/version-comparison.json). Clean reproduction archives and overlay locks are in that same directory; [RUN instructions](/tmp/helium-sol-submit-study-20261110/deliverables/RUN.md) explain their separate status. No original model generation/timing tests were repeated, and no original artifact was replaced.
