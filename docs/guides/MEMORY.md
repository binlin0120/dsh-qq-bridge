# Layered memory and source-backed recall

The bridge retains original per-chat daily archives, a SQLite index (`state/memory.sqlite`), sourced facts and episodes, and the legacy memory book. New facts are canonical in SQLite; the old book remains a compatible legacy input. It is not repeatedly replaced by generated summaries.

Owner chat receives a bounded core projection plus locally retrieved evidence before model inference. Group recall uses that group alone. The incoming conversation determines scope; a model cannot choose another private scope. Retrieval uses Chinese segmentation, short terms, limited aliases, time windows and recent reference context. Embeddings and external vector services are not enabled.

`memory` configuration defaults: `recallEnabled: true`, `minMessages: 8`, `idleMs: 300000`. Turning recall off disables historical retrieval but retains structured core facts, corrections and forgetting filters. It does not delete the database. Keep all new state when changing readers or rolling back code.

Incremental extraction runs when idle; a small batch can be processed after 24 hours. Original message IDs and SQLite sequences determine progress, independently of trimmed hot logs. Migration uses an archived boundary from a completed legacy summary only when it can be verified; otherwise it reconsiders original input without executing historic actions. Each extracted item must cite user messages from that batch. Assistant text is not confirmation. Failed batches pause durably, including when new messages arrive. Manual `/api/memory/consolidate` with the owner key and `resume: true` is required to resume; `reprocess: true` additionally requests a fresh extraction rather than cached output. Do not use it to automatically retry uncertain upstream calls.

The foreground `memory` action supports `remember`, `query`, `correct`, and `forget`. Writes are owner-private and use real current source IDs. Corrections use an actual returned memory ID and preserve provenance; core legacy edits also use the book's revision checks and journal. The authenticated maintenance endpoint `POST /api/memory/recall` accepts a query and an allowed target. Current core and recall entries expose stable IDs for precise edits.

Forgetting suppresses the selected evidence and dependent memories from retrieval and filters recent/legacy prompt inputs. Original archives and backups are retained for recovery; this is not a promise of physical deletion from every historical copy. Masks match source IDs and normalized text; arbitrary paraphrases without shared provenance are not a universally solved semantic deletion problem. Explicit permanent deletion requires a defined scope, including backups.

Schedule creation, mutation, claims and receipts stay in the existing reminder system. Archive imports, extraction, weekly diaries and recall cannot execute old requests or recreate reminders. Past course information must not establish a new recurring timetable.

The existing backup script detects project SQLite files and snapshots them online. Verify `memory.sqlite` appears among its snapshot entries and verify the archived database's integrity. Keep the configured single verified latest project backup.

Run `node --test scripts/test-episodic-memory.mjs` for focused fixture tests; `npm test` includes these checks. Tests never send production QQ messages or invoke paid media generation. A live model probe and an actual QQ delivery are different acceptance checks.
