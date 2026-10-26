# xACL-Era · LaTeX writing quality annotation

An English-first, bilingual website for independent human ratings of a frozen 30-paper sample. The protocol is **latex-writing-quality-v1**: five source-level writing scores and a separate optional target-PDF visual check. Release requires the matching database migration and successful verification.

## What is scored

| Core dimension | Scope |
|---|---|
| Language Clarity & Fluency | Comprehensible wording, grammar and terminology |
| Coherence & Logical Flow | Connections across sentences, sections and supporting explanations |
| Structural Completeness | A complete account for the paper type, stated aims and its own dependencies |
| Technical Expression & Referential Clarity | Definitions, concepts, methods, notation, explanations and referential links |
| Overall Writing Quality | A direct overall judgment; no component average or weighted total |

Each core response is **1–5 or Uncertain**. No core N/A is used: a paper without figures or equations can still explain concepts, methods or analysis. Completion requires all five responses and confirmation of the declared reading scope. Uncertain is an answered rating, not evidence that a paper is qualified. A completed annotation is not an acceptance decision.

The target is the writing represented by the selected arXiv LaTeX source version. Humans read its compiled PDF as a convenient representation; a source-reading LLM need not compile a PDF. The shared canonical anchors, input proposal and English instructions are under `docs/latex-writing-quality-v1/`. The model rubric is byte-identical to the active site rubric. Human PDF and model source-only conditions must be reported as different reading representations.

The frozen UI manifest identifies arXiv versions and PDF hashes, but does not contain source-bundle hashes. Before a source-only judge run is compared with these human ratings, its run manifest must bind the actual source files and any local compilation patches to the frozen PDF target. This interface release does not itself build or validate that source packet.

Judge communication rather than novelty, scientific truth, code elegance or preferred typesetting. Completeness does not mean matching the conference version or following a fixed experimental section template. A confirmed source omission can affect writing quality; a preprocessing or display failure alone cannot. If display problems block judgment and no readable same-source view is available, use Uncertain for the affected writing dimensions.

## Independent auxiliary activities

**PDF Visual Integrity & Legibility** is optional, with 1–5 or Uncertain and separate visual issue codes. It is stored under `auxiliary_checks.pdf_visual_integrity`, outside `scores`. Its default is not_assessed with no score or issues. Rate it before recording visual issues; Clear visual check resets this auxiliary object. It never caps writing scores or blocks completion. Editing it preserves an already completed core annotation.

**Conference-version audit** is optional and follows core completion. Until explicitly opened, the official PDF is hidden and is not downloaded by this interface. Opening the audit reveals the official PDF and version observations and records `reference_exposed: true`. Closing, reloading or editing core scores does not reset that flag. This records interface exposure, not what a person read elsewhere. Version observations never cap writing scores. The images, structure or numeric results in a later conference version are not automatic penalties.

Evidence/page-reference and private-note inputs remain absent. Version notes are optional. Earlier fields and records remain in their original protocol archive.

## Annotator workflow

1. Create a pseudonymous nickname, save the generated recovery code, or continue an existing profile. Existing identities and recovery codes work with the new protocol.
2. Begin with 0/30 completed and all five writing ratings unanswered. No earlier writing, alignment or visual scores are copied.
3. Read the target manuscript, rate the five dimensions using the expanded definitions, confirm the reading scope and mark it complete. The visual check may be left unassessed.
4. Optionally open the conference-version audit. The two-view comparison preserves independent page offsets and offers Sync page turns in normal and expanded modes. Primary reading without a reference moves only the target PDF.
5. Use bottom Previous/Next navigation. Wait for Saved before closing. Continue resumes the first unfinished writing annotation; recovery on another device uses the same nickname and recovery code.

Normal annotation-data export belongs to the maintainer. The browser offers private emergency recovery downloads only when unsaved work needs protection. Optimistic revision conflicts never overwrite the other device's saved answer.

## Protocol archives and storage

The original manifest, selection, provenance, alignment rubric/guidance and all 60 PDFs remain byte-identical under `frozen-assets.json`. The six-dimension document-quality assets remain byte-identical under `quality-assets.json`; their configuration is preserved at `site/protocols/document-quality-v1/config.json`. New writing assets and that archived config are locked by `writing-assets.json`. The manifest's original alignment rubric identifies sample provenance, not the active scoring rubric.

Alignment records/history remain in their original tables. The six-dimension and new writing protocols use different protocol keys in the existing multi-protocol `xacl_private.quality_protocol_config`, `quality_annotation_records` and immutable `quality_annotation_history` tables. Existing rows, timestamps, hashes and history are not relabeled or migrated. New records have a different schema, rubric and guidance. Old saves are revoked so cached older interfaces cannot change archived ratings.

Profile identities, recovery-code hashes and authenticated device bindings are shared. All active records pass the new protocol validator; old JSON and old local recovery copies cannot be applied. Each protocol has an isolated local recovery namespace. Recorded reference exposure can move only from false to true, including when a later whole-record save tries to remove that paper's row.

## Database migration and deployment

Anonymous Sign-Ins must remain enabled in Supabase. `site/config.json` contains only a public publishable key, never an administrator credential.

Before publishing this frontend, the database owner must execute **`supabase/setup-writing.sql`**. It is the exact reviewed bundle of the additive `003_latex_writing.sql` migration and requires the existing 001 and 002 migrations. It creates no participants or recovery codes. It is idempotent for the recognized frozen metadata and rejects unexpected drift.

For a new database, apply `setup.sql`, then `setup-quality.sql`, then `setup-writing.sql`. Writing must be last: rerunning older setup bundles can reinstate old API write permissions. New health, protocol, rubric, guidance and cohort hashes must match before scoring is enabled. The active frontend calls only `xacl_writing_*` RPCs; it never falls back to archived saves.

GitHub verifies a feature branch without deployment. Only a successful main-branch workflow deploys `site/` to Pages. Do not publish the new interface before the production writing health endpoint is ready.

## Maintainer export and reproducibility

Use a privileged database connection or Supabase SQL Editor, and select the protocol explicitly:

```sql
SELECT protocol_id, annotator_id, revision, current_record, saved_at
FROM xacl_private.quality_annotation_records
WHERE protocol_id = 'latex-writing-quality-v1'
ORDER BY annotator_id;
```

History and earlier protocols remain separately exportable. Do not put privileged credentials, recovery codes, individual answers or test outputs in the public repository.

Run legacy database baselines before applying the new migration, then writing checks:

```bash
python3 scripts/verify_site.py
python3 tests/backend_setup.py
python3 tests/quality_backend_setup.py
python3 tests/writing_backend_setup.py
node --test tests/frontend*.mjs
# A disposable 001+002 database is required here; writing_upgrade applies 003.
XACL_DISPOSABLE_DATABASE=1 QA_DATABASE_URL=... python3 tests/writing_upgrade.py
XACL_DISPOSABLE_DATABASE=1 QA_DATABASE_URL=... node tests/browser_writing.cjs
```

See `docs/verification.md` for the complete ordered baseline. The older browser suites are historical UI evidence. All software fixtures are isolated from real ratings. The frozen sample remains 15 early and 15 late papers across ten areas; this UI does not resample or validate every source article in the 600-paper dataset. A 30-paper set used to select a judge is calibration, not an independent test.
