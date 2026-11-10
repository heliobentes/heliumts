# Offline project-memory prototype and Sol pilot

## Result

The prototype works locally, but this small pilot did **not** demonstrate agent token or time savings. All seven single-turn calls effectively passed their quality gates; no repair/replacement calls were made. This is one two-change sequence per arm in a localized worker module, not evidence about whole-project navigation or large applications.

| Arm | Task-only tokens | Full setup-inclusive tokens | Cached input incl setup | New input incl setup | Output incl setup | Generation+tools incl setup (s) |
|---|---:|---:|---:|---:|---:|---:|
| no-memory | 184,015 | 184,015 | 130,304 | 51,760 | 1,951 | 59.732 |
| fts | 569,292 | 981,119 | 846,080 | 127,660 | 7,379 | 195.481 |
| hybrid | 669,130 | 1,080,957 | 948,224 | 126,177 | 6,556 | 185.856 |

Actual seven-call total: 1,834,264 = 1,820,773 input + 13,491 output; cached 1,584,384, fresh 236,389. Shared bootstrap was ONE actual call: 411,827 total / 69,208 fresh / 64.578s generation. Its FULL cost is allocated to each memory arm for standalone adoption comparison; summing allocated arms would double-count one bootstrap. Reasoning subsets are recorded but never added to output again.

Task-only generation+tools: no-memory59.732s; FTS130.903s; hybrid121.278s. The localized two changes were already inexpensive to explore directly. Card creation, reads and maintenance added work here; even excluding bootstrap neither memory arm reduced observed generation time or total tokens. No adoption/savings recommendation follows from n=1.

## What was tested

Actual current Helium defineWorker/logger/context and26 regression tests were copied into fresh isolated source fixtures. Change1 adds cancellable first-start initialDelayMs; change2 adds a validated capped restart-backoff multiplier. Protected independent tests total32 after step1 and39 after step2. Static build/typecheck/lint and exact source allowlists pass. Agent cards preserve the protected user-owned note, resolve actual symbols/tests, have fresh evidence and a rebuilt index, and pass logged coordinator factual review. No coordinator wrote feature fixes or knowledge answers. The bootstrap authored seven cards from unchanged source before future tasks were supplied. The source fixture was restored/frozen before any generation. Main Helium worker/product code never received trial features.

Global Codex memories, external-agent memory import and multi-agent features were explicitly disabled; effective metadata and every plan command are recorded. --ignore-user-config and --ephemeral were used. gpt-6.1-sol medium, default Standard, ChatGPT subscription only, no credits/fallback. Each primary call capped at600s, no retry/repair/replacement. The actual order is bootstrap,no-memory1/2,FTS1/2,hybrid1/2. Cache/order/host effects are uncontrolled.

Stage2 receives an append-only visible-event replay, not a native resumed conversation or hidden reasoning. Tool lifecycle events and outputs are replayed consistently; current source remains accessible. This synthetic context policy can add overhead, especially when maintenance created more tool output. Bootstrap future tasks were withheld by prompt/protocol, not a strong filesystem secrecy boundary. Trace audit finds no no-memory card/CLI use; workspace isolation remains observational read isolation.

Generation duration includes child tools, static verification, memory indexing/query/model startup and card maintenance. Outer-to-evaluation includes independent validation; outer-through-review also includes coordinator review/polling/triage waits and is reported separately. Coordinator model/review token usage is not exposed and is NOT included; this is not total account AI usage or dollar cost. No model output tokens were subtracted for mistakes.

## Guard amendment

FTS step1 raw integrity=false is preserved. The sole delta was the legitimate2-byte `*\n` .helium/cache/.gitignore created by memory initialization: source snapshots already excluded that predeclared disposable cache, but the protected-file walker accidentally matched its basename .gitignore. Versioned cache-guard-v2 applies the same narrow cache exclusion; calibration proves real root .gitignore and user-note edits still fail. User note/source/dependencies were unchanged; code/cards/index already passed. Effective quality is corrected, with no model rerun or source edits. The extra diagnostic/review wall delay remains visible and should not be attributed to the framework.

## Delivered prototype

Commands: memory init/add/show/status/index/search. Markdown/JSON cards use stable IDs, symbol/test content hashes, and current AST-resolved lines; no application code is executed. SQLite FTS and optional local cosine hybrid index are disposable and per-worktree; branch/HEAD/card/evidence changes demand rebuilds. Creation refuses overwrites; user cards are never automatically rewritten. Merge/duplicate/schema errors, unsafe references and stale evidence get explicit diagnostics. Secret redaction is heuristic, not a complete detector. Search results are candidates, not verified answers/confidence.

The default ordinary package is still lightweight FTS unless a pack is bundled. An experimental npm artifact includes reviewed MiniLM weights/tokenizer/slim WASM runtime/licenses and auto-detects them from first search. Explicit --model supports either approved pack; --fts forces lexical baseline. No remote downloader, service or native model addon. Model/runtime manifests are allowlisted and all asset hashes checked before executable runtime import. No RPC/hooks/auth/cancellation APIs were replaced and no TanStack/HTTP endpoint abstraction was added.

Experimental artifact: deliverables/heliumts-0.10.2-memory-experimental.tgz,19,883,537B compressed. It was freshly installed using npm --offline on the cached host. In actual OS network-disabled/workspace-only sandbox, first hybrid index/search succeeded without a --model path or network attempts; independent TCP/outside-write probes failed EPERM. Index0.401s, first-search0.382s on a one-card fixture include CLI/process/model startup; not universal latency claims. Initial dependency installation on an empty computer still needs normal npm dependencies/cache. Normal published packages are not claimed to include weights yet.

Optional SQLite memory indexing requires a Node runtime with node:sqlite; Node20 normal Helium support is unchanged. The index diagnostic recommends Node22.13+/24+. WASM/pack proof was only on macOS ARM64 Node26, with comparison peak RSS around375MiB; no claim it works on any computer/browser.

## Two-model comparison (separate from agent costs)

Frozen24-card/20-query corpus includes4negative queries. MiniLM slim pack~34.3MiB, BGE~44.8MiB before gzip. FTS MRR@5 .90625 / Recall@3 .9375; MiniLM dense/hybrid .9375 /1.0 here. MiniLM was the smaller/faster/front-runner on this tiny corpus; not a universal model recommendation. Full exact metrics and licenses/revisions are in embedding-comparison.md/csv and pack manifests.

MiniLM actually enforces256-token truncation; corpus maximum83tokens, zero truncated examples, so this original comparison did not test long-card tails. BGE used CLS pooling and query-only prefix `Represent this sentence for searching relevant passages: ` (trailing space); documents were unprefixed. This original comparison contained no BGE no-prefix ablation. Semantic retrieval returns candidates even for unrelated queries; no abstention/answer-correctness claim.

A separate [retrieval-limit diagnostic extension](./project-memory-retrieval-limits-20261109.md) tests long-card placement and BGE with and without its query prefix. It preserves the original corpus, model manifests and metrics above. Its synthetic example and small in-sample ablation do not establish general retrieval reliability or agent token/time savings.

## Validation/artifacts

Required combined commands passed: npm run build; npm run typecheck; npm test (71files,923tests); npm run lint. Relevant docs, packed public API and built-app smoke all pass. Eleven focused memory tests cover current lines/staleness, branch/cache/user edits, reference safety, merge IDs, FTS/hybrid identity and refusing untrusted runtime manifests. Worker simplification independently retains26 tests and the combined suite. No generated dist was hand-edited.

All original frozen inputs and v2 amendment hashes verify; preexisting dirty changes were preserved. Prototype owned files/hashes are in prototype-files.json. Exact per-turn/allocation CSVs and JSON are in reports/; source archives, generated cards, full validation logs, standalone model comparison and installed proof in deliverables/. Source fixtures are scratch framework subsets with dependency digests in plans, not deployable full apps. Their package memory script points to the recorded installed tool path; for replay use the included experimental artifact and adjust only an extracted copy to your installed CLI. Hidden protected feature tests are provided separately as feature-contracts.test.ts.

No additional metered calls were launched after the approved seven. No publishing, pushing, purchases or main-source trial fixes occurred.
