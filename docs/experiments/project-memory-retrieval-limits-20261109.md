# Project-memory retrieval-limit diagnostic extension

This separate local diagnostic preserves the [original comparison and Sol pilot](./project-memory-20261109.md), its frozen corpus and both model manifests. It uses the already reviewed CPU WASM packs on macOS arm64, Node 26.13.0, with no downloads or metered agent calls. Execution used an OS network-disabled Codex sandbox plus application network guards; zero network attempts occurred. CPU inference finished before the continuation's measured generation began.

## MiniLM long-card placement

One synthetic fact, one query, four placement variants and four fixed distractors were frozen before inference. This diagnoses a failure mode; it is not a repository behavior claim or a representative retrieval benchmark. MiniLM explicitly truncates to 256 WordPiece tokens and uses attention-masked mean pooling.

Fact: “The emergency maintenance console uses the cobalt otter passphrase.” Query: “Where is the cobalt otter passphrase used?” Long variants repeat an unrelated documentation sentence before or after the fact.

| Placement | Full / encoded tokens | Fact retained | Target rank among 5 | Cosine | Inference ms |
|---|---:|---|---:|---:|---:|
| Short | 14 / 14 | Yes | 1 | 0.739 | 6.4 |
| Front | 454 / 256 | Yes | 2 | 0.269 | 106.2 |
| Tail | 454 / 256 | No | 5 | 0.030 | 105.9 |
| Fact absent | 442 / 256 | No | 5 | 0.030 | 105.5 |

The tail's truncated token IDs exactly match the fact-absent control, and their embedding vectors have zero maximum absolute difference. The retained front fact still ranks below a shorter distractor, demonstrating dilution in this example. The original corpus's maximum of 83 tokens could not expose these failures. Single-run timings are illustrative, not stable latency estimates.

Small focused cards and a critical summary first reduce exposure to these limits. A byte-size ceiling does not prevent token truncation. Production chunking, rejection or explicit truncation diagnostics need their own validation; this diagnostic does not select a policy. FTS still indexes full bounded card text, but hybrid ranking does not guarantee retrieval of every fact.

## BGE query-prefix ablation

Both configurations use the same frozen 24 cards and 20 queries: 16 answerable (4 exact symbols, 12 concepts) and 4 negative queries. Relevance, CLS pooling, L2 normalization, 512-token cap, document embeddings and hybrid weights are unchanged. Only the query prefix changes. The prefixed configuration uses `Represent this sentence for searching relevant passages: `, including its trailing space. Documents remain unprefixed. [Upstream BGE v1.5 guidance](https://huggingface.co/BAAI/bge-small-en-v1.5) permits omitting the instruction.

| Configuration | Dense MRR@5 / Recall@3 | Hybrid MRR@5 / Recall@3 | Query median / p95 ms |
|---|---|---|---|
| Query prefix | 0.90625 / 0.91667 | 0.921875 / 0.93750 | 21.47 / 28.16 |
| No prefix | 0.90625 / 0.91667 | 0.921875 / 0.93750 | 15.56 / 22.18 |

Aggregate answerable-query metrics and dense/hybrid top candidates were identical across all 20 queries. No-prefix queries were eight tokens shorter and faster in this single sequential run. Each configuration has 60 query measurements; order was fixed, prefix first, without randomized timing controls. This does not establish a general quality preference or cross-machine speed guarantee. MiniLM's original advantage on these metrics is unchanged.

All four negatives still return candidates. The PostgreSQL migration, Stripe billing and GraphQL gateway queries receive irrelevant dense top candidates in both configurations; the WebSocket query retrieves a related HTTP RPC card that can help reject its false premise. Hybrid returns lexical candidates for all four. Similarity scores are not verified answers or calibrated confidence; no abstention or generated-answer correctness was evaluated. Small manual in-sample bias remains, and no agent token/time savings follow.

## Evidence

The separate diagnostic artifacts are in `/tmp/helium-embedding-extension-20261109`: `protocol.json`, `results.json`, `configuration-differences.json`, `comparison.csv`, `long-card.csv` and `deliverables-manifest.json`. Original assets remain under `/tmp/helium-embedding-comparison`; these scratch paths need archiving alongside the experiment for replay.

- Frozen corpus SHA256: `1fd8878e4442dad2944a31509732904dba58d8e3340c41f283905b6bd331f8bc`.
- Extension protocol SHA256: `077fc762c8087a090fb9ad0f1215a389cdc1e892b9aedb27a0aeb83c118db32f`.
- Unchanged MiniLM manifest SHA256: `23e861c50221d2eb88358fa958ecc0016ff05ba6d8931a379fb5388e5165d162`.
- Unchanged BGE manifest SHA256: `ee6c1a3d091a1deb1ea426c866ade98e6ce153e3c8ca72ea8b95591b3ca24a1d`.
