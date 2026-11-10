# Public memory workflow iteration — 2026-11-09

Implemented and validated the public workflow, then completed all7approved Sol6.1 medium/Standard one-turn calls:1shared selective-card bootstrap and6matched archive/restore feature variants. All6 applications pass exact static checks and68real runtime tests with zero skips, protected-source integrity and current-card review. No repairs/replacements, evaluator amendments or coordinator app fixes.

## What changed in the product

- Public create/update/review accepts multi-symbol/test JSON, computes evidence hashes/current AST lines, preserves user metadata/body by default and uses exact-byte revision checks plus cooperative locks/atomic publication. Explicit replacement/evidence acknowledgement is not truth certification.
- Search defaults to3candidates with240-character excerpts, current references and stale flags; --detail exposes full metadata. Status is compact; show exposes full card/revision. Programmatic search remains detailed.
- Search automatically refreshes disposable SQLite cache incrementally. Unchanged embedding text+model/preprocessing identity reuses vectors; evidence-only changes still warn until explicitly reviewed. Cache refresh never rewrites cards or clears stale evidence.
- Long documents use overlapping token windows, full-text FTS and per-card maximum chunk cosine; no silent tail truncation. This is token coverage, not guaranteed relevance. Cards/maintenance are selective, not mandatory per feature.

Files: src/bin/memory/{cards,command,index,localEmbedding}.ts; lazy options in src/bin/helium.ts; tests/bin/memory.test.ts; docs/memory.md. Unrelated dirty framework changes were preserved.

Validation: npm run build, npm run typecheck, npm test (928/71files), npm run lint, npm run test:docs, npm run test:api and npm run test:smoke passed. Fresh experimental package installed via npm --offline. Actual network-disabled sandbox public CLI proof passed default bundled hybrid first search,6long-document chunks, zero reembedding after evidence-only edits, retained staleness, CAS rejection and exact body preservation. Package19,895,682bytes; normal package dependencies unchanged. NodeSQLite/host portability limits remain; tested MacARM64/Node26, not every computer.

## Task-only results (bootstrap excluded)

| Context | Treatment | Input | Cached | Fresh | Output | Total | Generation+tools s | Archive+evaluation overhead s |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| fresh | no-memory | 285,151 | 258,560 | 26,591 | 3,099 | 288,250 | 77.80 | 5.02 |
| fresh | fts | 397,584 | 348,160 | 49,424 | 4,109 | 401,693 | 103.39 | 5.28 |
| fresh | hybrid | 221,605 | 180,480 | 41,125 | 2,940 | 224,545 | 74.41 | 5.26 |
| continued | no-memory | 258,469 | 190,208 | 68,261 | 1,598 | 260,067 | 45.73 | 4.91 |
| continued | fts | 535,746 | 468,224 | 67,522 | 2,077 | 537,823 | 62.06 | 5.42 |
| continued | hybrid | 550,968 | 471,552 | 79,416 | 2,271 | 553,239 | 64.59 | 5.28 |

Fresh hybrid used22.1%fewer total tokens and4.4%less generation time than fresh no-memory in this ONE observation, but54.7%more fresh input (41,125vs26,591). Cache/order are uncontrolled. FTS did not improve this task; both memory treatments cost more in continued context. This is not a general winner or dollar-cost claim.

## Initial creation and allocated totals

Shared bootstrap:251,214input =204,288cached +46,926fresh;2,192output;253,406total tokens;56.33generation seconds. Full cost is charged to EACH of4memoryvariants below, while actual usage counts bootstrap only ONCE.

| Context | Treatment | Allocated total | Cached input | Fresh input | Output | Allocated generation s |
|---|---|---:|---:|---:|---:|---:|
| fresh | no-memory | 288,250 | 258,560 | 26,591 | 3,099 | 77.80 |
| fresh | fts | 655,099 | 552,448 | 96,350 | 6,301 | 159.72 |
| fresh | hybrid | 477,951 | 384,768 | 88,051 | 5,132 | 130.74 |
| continued | no-memory | 260,067 | 190,208 | 68,261 | 1,598 | 45.73 |
| continued | fts | 791,229 | 672,512 | 114,448 | 4,269 | 118.39 |
| continued | hybrid | 806,645 | 675,840 | 126,342 | 4,463 | 120.92 |

Including initial creation reverses the fresh-hybrid task-only advantage for this one feature. Actual7calls total2,519,023tokens =2,500,737input +18,286output;2,121,472cached input and379,265fresh. Reasoning is an output subset. All retrieval/index/model startup, maintenance and within-turn self-corrections are included. No paid fallback. Coordinator planning/development/calibration/review usage is unexposed and excluded. Sum stage intervals is not total study wall time; through-review waits are separately recorded in CSV.

## Matched design and audit

All6variants began with byte-identical canonical n5 backend source/tests/config/dependencies and the same archive/restore task; only memory treatment and context mode differed. Fresh prompts contained no old transcript (3.9–5.4KB). Continued prompts contained the SAME canonical no-memory prior visible history (176.9–178.4KB), not arm-specific histories. Continued is synthetic visible-event replay, not native hidden-context resume. Bootstrap had no future feature task; withholding is protocol-based, not filesystem secrecy. Order was b00,fresh-hybrid,continued-none,fresh-fts,continued-hybrid,fresh-none,continued-fts.

Independent evaluator calibration BEFOREfreeze compiled the exact protected tests and ran68runtime cases/zero skips. Auth bypass, uncancelled running work, non-atomic archive, invalid flags, untyped refs and missing discovery negatives failed as intended; independent reviewer also rejected missing migration. Source-only discovery did not execute a top-level throw. Public registry.register and a test-only opaque-reference serialization boundary are used; no new production exports/deep-import guidance. Frozen29inputs verified unchanged.

All4memoryvariants used public CLI search/update/review; no private memory-module import/manual-hash patterns observed. First searches returned compact excerpts, no full body. Relevant store/job cards were retrieved; worker/RPC cards were partly relevant, not a prewritten archive solution. All4updated existing facts/evidence and kept6cards (5authored +protected user-note), adding no new feature card. Public workflow avoided required hash editing; this operational result is distinct from token savings.

Remaining friction retained/countable: bootstrap tried unsupported TaskStore.constructor, then corrected within the same turn; supported named symbols remain the documented path. Each fresh variant self-corrected one Prettier lint error. A grep miss also produced a nonzero command in fresh hybrid. No TypeScript diagnostic occurrences were observed. Compact first search still emitted about5.3KB because many symbol references were returned; further compression is a possible follow-up, not changed mid-study.

This single small backend feature does not show large-project amortization. Cache/order/background load are uncontrolled; fresh vs continued are separately labelled and not pooled. No direct cost claim comparing earlier memory versions: tasks, evaluator and context policies changed. Source bytes are not token-cost measurements.

## Artifacts

- [Raw turn CSV](/tmp/helium-sol-memory-workflow-study-20261109/reports/turns.csv), [allocated CSV](/tmp/helium-sol-memory-workflow-study-20261109/reports/allocated.csv), [metrics JSON](/tmp/helium-sol-memory-workflow-study-20261109/reports/results.json), [trace audit](/tmp/helium-sol-memory-workflow-study-20261109/reports/trace-audit.json), [retrieval audit](/tmp/helium-sol-memory-workflow-study-20261109/reports/retrieval-audit.json), [frozen integrity](/tmp/helium-sol-memory-workflow-study-20261109/reports/frozen-integrity.json).
- [Run/source instructions](/tmp/helium-sol-memory-workflow-study-20261109/deliverables/RUN.md); six candidate archives plus bootstrap and model-bundled experimental package in ../deliverables/.
- [Independent calibration logs](/tmp/helium-sol-memory-workflow-study-20261109/deliverables/independent-calibration/); original reviewer path /tmp/helium-memory-evaluator-independent-20261109.
- Product offline proof /tmp/helium-memory-workflow-v2-validation/installed/proof.json; source docs/memory.md.
