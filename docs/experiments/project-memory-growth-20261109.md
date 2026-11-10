# Project-memory growth continuation — 2026-11-09

All nine approved one-turn Sol6.1 calls completed, continuing the original seven-call pilot. No repairs/replacements or coordinator application/card edits. This grew a localized worker library into a small RPC-first task-processing backend, not a deployed application or UI. The memory arms did not demonstrate token or generation-time savings.

## Five-change cumulative results

The two original worker changes were followed by owner-scoped SQLite persistence/filtering/atomic validation; durable worker-driven processing with cancellation/retry; and authenticated typed RPC with bounded progress streaming.

| Arm | Total tokens | Cached input | Fresh input | Output | Generation + tools seconds | Sum through initial evaluation seconds |
|---|---:|---:|---:|---:|---:|---:|
| No memory | 1,041,937 | 854,016 | 178,449 | 9,472 | 246.73 | 265.36 |
| FTS cards | 2,800,761 | 2,431,744 | 348,402 | 20,615 | 505.69 | 529.95 |
| Hybrid cards | 3,306,240 | 2,969,344 | 318,219 | 18,677 | 486.03 | 509.45 |

The shared initial card bootstrap (411,827 tokens/64.58 seconds) is allocated in full to each memory arm above but counted only once in actual combined usage. Actual original seven plus new nine calls: **6,737,111 total tokens**, comprising 6,690,742 input and 46,369 output; input includes 5,914,880 cached and 775,862 fresh tokens. Reasoning is an output subset. Coordinator planning/review usage is unexposed and excluded; tokens are not dollars.

Excluding bootstrap, five-change task totals were 1,041,937/2,388,934/2,894,413 tokens and 246.73/441.11/421.45 generation seconds for no-memory/FTS/hybrid. Retrieval, indexing, card maintenance and self-corrections inside child turns remain counted.

Final source was 8 files per arm: 42,303/42,988/41,920 bytes and 1,019/1,056/1,029 nonblank lines respectively, including generated references and the supplied session fixture. Memory cards grew 8→10→12→14. This remains a small repository, not evidence about large projects.

## Validation and qualification

All three implementations pass corrected build/typecheck/lint and real RPC transport validation: 45 tests at persistence, 52 at processing, and 59 externally enabled tests at RPC. Coverage includes the prior worker regressions, persistence/ownership/atomic writes, durable processing/cancellation/retry/recovery, authenticated unary/stream transport, typed generated arguments and subscription abort. Protected source, dependencies and user-owned prose were preserved.

The hybrid RPC call `h5` encountered an evaluator defect: the protected test misused `MethodArgs<TArgs>`, a tuple utility, as reference-argument extraction. Runtime-only preflight calibration had missed this TypeScript assertion. Raw failure, original test, source and cards are retained. Versioned v2 corrected only the type assertion; unchanged application code passed, and a wrong-title negative failed compilation. No model repair occurred.

One hybrid card records that historical faulty test. It was accurate/fresh against v1 at generation but is **not certified current-v2**. Overall hybrid memory quality remains qualified, while corrected application quality passes. Future no-memory/FTS RPC calls received v2 before generation, so stage3 costs have unequal evaluator exposure and are not a clean paired ranking. All observed costs remain included. The hybrid archive needs the documented temporary evaluator replacement to replay corrected validation; its original raw test intentionally remains failing.

## Retrieval and truncation observations

Archived retrieval outputs were manually labelled without additional inference. Before SQLite implementation, worker cards were unrelated to new storage facts that did not yet exist. Before processing, signal/cleanup cards were relevant; before RPC, existing store/job cards were partly relevant. Post-change generic searches ranked current store/processor cards 1–2 in both arms; RPC cards ranked 1 and 5 for hybrid, 2 and 4 for FTS. Other candidates included unrelated user-note/worker cards. These observational labels do not prove retrieval helped coding.

Actual frozen MiniLM tokenization of indexed title/body/file-symbol text found **15 of 72 repeated post-stage card observations exceeding 256 tokens**, maximum 316, covering four unique cards. Final FTS had 4/14 over-length cards and hybrid 2/14. Runtime truncation may omit trailing evidence symbols; FTS indexes full text. No causal effect on costs is established. Compact metadata output, irrelevant-candidate filtering and budgeting symbol text are follow-up opportunities, not changes made during this study.

## Records and limitations

- [Complete report](/tmp/helium-sol-memory-growth-20261109/reports/report.md), [all 16 turns CSV](/tmp/helium-sol-memory-growth-20261109/reports/all-turns.csv), [new nine turns CSV](/tmp/helium-sol-memory-growth-20261109/reports/turns.csv), [metrics JSON](/tmp/helium-sol-memory-growth-20261109/reports/results.json).
- [Growth CSV](/tmp/helium-sol-memory-growth-20261109/reports/growth.csv), [retrieval audit](/tmp/helium-sol-memory-growth-20261109/reports/retrieval-audit.json), [token-length audit](/tmp/helium-sol-memory-growth-20261109/reports/card-token-lengths.json).
- [Evaluator amendment](/tmp/helium-sol-memory-growth-20261109/amendments/v2/manifest.json), [run/replay instructions](/tmp/helium-sol-memory-growth-20261109/deliverables/RUN.md), [artifact hashes](/tmp/helium-sol-memory-growth-20261109/reports/deliverables-manifest.json).
- Source archives: [no memory](/tmp/helium-sol-memory-growth-20261109/deliverables/no-memory-backend-source.tar.gz), [FTS](/tmp/helium-sol-memory-growth-20261109/deliverables/fts-backend-source.tar.gz), [hybrid historical candidate](/tmp/helium-sol-memory-growth-20261109/deliverables/hybrid-backend-source.tar.gz).

Sol6.1 medium/Standard, subscription only, no paid fallback. Rotated stage order; no concurrent evaluation during generation. Each arm continued its own prior implementation/history, not byte-identical source. Append-only visible-event replay is synthetic rather than native hidden-context continuation and can amplify output overhead. Future-task withholding was protocol-based. Cache/order/host load and coordinator review delays are uncontrolled; summed stage intervals are not whole-project elapsed. Frozen current/prior inputs verified unchanged. No framework source changes were made by the continuation. This n=1 sequence supports no large-project, dollar-cost or general superiority claim, and gives no adoption recommendation for token savings.
