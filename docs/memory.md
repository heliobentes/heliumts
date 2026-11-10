# Experimental project memory

`helium memory` is an experimental, optional local CLI tool for agent-authored project knowledge. It is not the default AI workflow: the small pilots did not establish general token/time savings. It does not replace RPC, hooks, authorization or application endpoints. Nothing is read automatically by an application or sent to a service.

## Cards are source; the index is disposable

Run `helium memory init` in a project. Review and version-control `.helium/memory/*.md`. `.helium/cache` is ignored by its own generated `.gitignore`; every real worktree gets a separate SQLite index. No commits, automatic card rewrites or repository-wide source harvesting occur.

Create cards selectively for durable decisions or non-obvious behavior. A routine change does not require a new card or an update when no recorded fact/evidence changed. Prefer a few focused cards over a per-change journal.

```json
{
  "title": "Cancel upstream streaming work",
  "body": "Disconnect aborts upstream work; partial text is not a completed answer.",
  "symbols": [{"file": "src/server/assistant.ts", "name": "streamAssistant"}],
  "tests": ["tests/assistant.test.ts"]
}
```

Run `helium memory init`, then save temporary JSON inputs under ignored `.helium/cache/` (for example `.helium/cache/card-input.json`); they are not additional version-controlled project files. The CLI reads but never removes/overwrites the input file. Use the public CLI:

```sh
helium memory create stream-cancellation --input .helium/cache/card-input.json
helium memory search 'stop provider work when the user disconnects' --fts --limit 3
helium memory show stream-cancellation
helium memory status
helium memory status --detail
```

`create` computes evidence hashes and returns current AST lines plus a revision. The existing single-symbol `add` command remains available. `show` exposes the full card, current evidence and exact-byte revision. Search defaults to three candidates with a bounded240-character excerpt; status gives a compact inventory; `--detail` includes bodies and evidence metadata. Programmatic search remains detailed. Candidates are not verified answers.

For updates, first inspect the card and current evidence. Put only intended fields in a JSON patch, for example `{"append":"Reviewed decision: preserve upstream errors."}`. Existing body bytes and other fields are preserved by default:

```sh
helium memory update stream-cancellation --input .helium/cache/card-patch.json --if-match REVISION_FROM_SHOW
# After actually reviewing changed source/tests, refresh evidence only:
helium memory review stream-cancellation --if-match CURRENT_REVISION --acknowledge
```

Updates can change title, append a note, or explicitly replace `body`; replacement and evidence-reference changes require `--acknowledge`. Preserve user prose when replacing obsolete facts. `symbols` and `tests` arrays replace the corresponding evidence lists, with hashes computed automatically. `review` acknowledges current evidence, **not** the truth of old prose. No automatic operation refreshes recorded evidence or certifies facts. Invalid input or stale revision fails without replacing the card. Cooperative CLI writers serialize per card and publish atomically; an exact-byte recheck detects edits made before publication, but an unrelated editor does not participate in that lock. Review version-control diffs.

A card is Markdown with JSON front matter: version1, stable ID, title, symbol file/name/hash and test file/hash references. Lines/revisions are read-time information, not persisted offsets. Creation never overwrites an existing card. Card files remain ordinary user-editable source.

Lines are resolved from the current TypeScript AST, not saved offsets. Named functions (including overloads), variables, classes, interfaces, types, enums and class methods (`Class.method`) are supported. Missing/ambiguous symbols, changed declarations/tests, duplicate IDs, merge markers and unsupported schemas produce diagnostics. Hash equality means recorded evidence is unchanged; it is not proof that a claim is true or that unreferenced dependencies have not changed. Include all important symbol/test evidence. Card bodies and explicit references only are indexed, not entire source files.

Index fingerprints cover full card/evidence contents and Git branch/HEAD/worktree context. Search automatically refreshes its disposable index after card/evidence/branch changes. Only changed/deleted documents are updated; unchanged embedding text reuses vectors for the same model/preprocessing identity, even when evidence hashes/line positions changed. `index` is an optional explicit refresh/diagnostic. Refresh reports stale cards and never repairs their statements or acknowledges evidence. Searches return bounded **candidates**, not verified answers or calibrated confidence. Semantic search may return irrelevant candidates for an unrelated question. Inspect the card, stale flags and current references before acting.

## Offline semantic packs

Ordinary package installs currently use FTS unless a reviewed pack is bundled at package-root `memory-model`. The experimental bundled artifact includes MiniLM weights, tokenizer, a fixed slim JavaScript/WASM runtime and licenses. It performs inference locally from its first search, with no downloader, native addon, HTTP service or API key. It does not require the full Transformers installation.

```sh
# Explicit reviewed pack, if not using the experimental bundled artifact:
helium memory index --model /local/pack/minilm
helium memory search 'release a provider after cancellation' --model /local/pack/minilm
# Explicit lexical baseline even when a model is bundled:
helium memory index --fts
helium memory search 'provider cancellation' --fts
```

Pack/model revision and preprocessing identity are part of index metadata; selecting another reviewed model refreshes cached vectors automatically. An explicitly missing, modified or unrecognized pack errors rather than downloading or silently trusting code. Only the two reviewed prototype manifest hashes are accepted; self-authored hashes cannot authorize an arbitrary runtime plugin. All listed assets are verified before runtime import. MiniLM uses attention-masked mean pooling with 256-token windows; BGE uses CLS pooling, its query-only instruction, and 512-token windows. Both normalize vectors. FTS retains the full bounded card text. Hybrid ranking combines lexical rank and cosine similarity; its score is not a probability.

Long documents are tokenized without truncation and indexed as overlapping windows, retaining BERT boundary tokens. Every content token, including trailing evidence references, appears in at least one window. Hybrid ranking uses the highest window cosine per card; FTS retains the entire bounded text. Index diagnostics report stored semantic chunk count. This avoids silently dropping the tail, but does not guarantee relevance or preserve every relationship across window boundaries. `show`/`--detail` expose full text. Keep cards focused to reduce inference, review and context costs.

From the HeliumTS contributor checkout, create the experimental bundled npm artifact after `npm run build`, with an already present reviewed pack:

```sh
npm run memory:bundle -- --model /local/pack/minilm --out /tmp/helium-memory-artifacts
```

This offline packaging command includes the approved assets and notices in a separate experimental tarball. It never changes the normal package's dependencies, copies weights into the working tree, downloads files or overwrites an existing output. Normal published packages are not claimed to ship these weights until that distribution decision is made.

## Limits and safeguards

The optional index requires Node with `node:sqlite` (Node22.13+ or Node24+ recommended). Normal Helium commands keep their existing Node20 support; card status/show do not need SQLite. WASM inference has been tested on the development host; that is not a guarantee for every computer, custom Node build or browser. There is no browser/client import of the memory subsystem.

References are scoped to the explicit repository, reject traversal/symlinks and environment/key/database/build/dependency files, and are capped at256KB each. Cards are capped at32KB and500 total. Summary redaction detects some common credential/private-key patterns before indexing/embedding/output; creation rejects matching summaries. This is a precaution, not a complete secret detector. Do not put credentials or private data in cards. Existing user cards are never silently sanitized on disk. Review files before committing. The cache contains card summaries/vectors and should remain local, even though it is ignored.

There is no remote fallback. Network-blocked tests, model comparisons and future end-to-end token measurements should be reported separately; source bytes or retrieval accuracy alone do not establish agent token/time savings. Count initial card creation, index/model startup, reads, code work, card maintenance, retries and validation in such measurements.
