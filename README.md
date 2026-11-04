# xACL-Era · main-paper writing quality annotation

English-first, bilingual annotation for the frozen 30-paper sample. The active protocol is **`latex-writing-quality-9p-v1`**: five core writing ratings (1–5 or Uncertain), with a separate optional PDF visual check. Frontend publication requires the matching production database migration and passing checks.

## Shared human/model scope

Score the main-paper writing within **physical PDF pages 1–9, inclusive, or all existing pages if shorter**. Count from the PDF's first page, including the title page, not printed proceedings numbers. Include the title, abstract and in-scope technical explanations/captions. The complete target PDF and appendix remain browsable for auxiliary reference. Reference lists and appendices are not core-scored, even if they appear inside the window; later pages are also outside core scoring.

Do not penalize a passage, table or equation continuing after page nine, a later conclusion, or reasonable appendix deferral. Structural Completeness concerns organization and narrative completeness **within the observed window**, not the unobserved complete article. Reading the full appendix is not required for completion.

The five dimensions are Language Clarity & Fluency, Coherence & Logical Flow, Structural Completeness, Technical Expression & Referential Clarity, and Overall Writing Quality. All apply without mandatory figures/equations, with no core N/A. Judge Overall directly, not as an average or capped total. Judge communication, not novelty, scientific correctness, source-code elegance or image aesthetics. Unreadable/missing input is an assessment limitation, not automatically poor writing.

Canonical shared definitions, full scoring anchors, the exact system prompt, input/output templates and participant instructions are in [`docs/latex-writing-quality-9p-v1/`](docs/latex-writing-quality-9p-v1/README.md). Its `rubric.json` is byte-identical to the active site rubric. Humans read the target PDF; multimodal judges receive corresponding active LaTeX plus ordered images of the assigned pages. Separately declared appendix/reference material is supporting evidence, not additional scored prose. Judge outputs record consulted supporting blocks and the reading representation. The human interface allows auxiliary browsing but does not claim to measure actual appendix reading.

## Participant workflow and independent checks

Create or restore a pseudonymous profile using the existing nickname and personal recovery code. The nine-page protocol starts with blank ratings; previous ratings are not copied. Read the assigned window, optionally consult supporting pages, complete five ratings and confirm the assigned scope. All score definitions remain open by default. Autosave acknowledgments, first-unfinished resume, private unsaved recovery and bottom Previous/Next navigation remain available.

PDF Visual Integrity & Legibility is optional and applies only to inspected target pages. It is stored outside `scores`, never caps core ratings and does not gate completion. The official conference PDF remains hidden until an optional version audit is opened after core completion. Interface reference exposure is recorded monotonically; it does not prove external reading. Version observations never automatically change writing scores.

The full PDF link may expose pages beyond the scoring window; these remain auxiliary. Displaying a complete file does not broaden the scoring scope.

## Preservation and persistence

The original cohort, selection, provenance and all 60 PDFs remain byte-identical under `frozen-assets.json`. Alignment, document-quality and full-scope writing assets/records/history remain archived. `writing-assets.json` still protects the old writing assets; the exact previous config is at `site/protocols/latex-writing-quality-v1/config.json`. New metadata and that archived config are locked by `writing9p-assets.json`.

The new scope uses a distinct protocol key in private multi-protocol tables and `xacl_writing9p_*` RPCs. Existing identities/recovery are reused. No old score, timestamp or history is relabeled. Old writing saves are revoked after migration004; old read paths remain available. `reviewed_full_scope` in the new record means the assigned page window, not the full article/appendix. Normal data export belongs to the maintainer, never the participant interface.

Maintainer export, using authorized database access:

```sql
SELECT annotator_id, revision, current_record, rubric_version, rubric_sha256,
       guidance_version, guidance_sha256, saved_at
FROM xacl_private.quality_annotation_records
WHERE protocol_id = 'latex-writing-quality-9p-v1'
ORDER BY annotator_id;
```

## Database upgrade and release

After migrations001–003, the database owner executes [`supabase/setup-writing9p.sql`](supabase/setup-writing9p.sql), the exact reviewed migration004 bundle. It creates no participants and preserves previous protocol records/history. On a new database install `setup.sql`, `setup-quality.sql`, `setup-writing.sql`, then `setup-writing9p.sql`, in that order. Reapplying archived migrations afterward can restore archived write grants; the latest migration must remain last.

Do not publish the frontend until the production nine-page health endpoint agrees with the protocol, cohort, rubric and guidance hashes. Missing migration diagnostics are a deployment blocker, not a reason to bypass hash checks. A non-main branch can be verified without deployment; only a successful main workflow deploys `site/` to Pages.

Verification includes frozen-asset checks, shared protocol metadata, old/current unit tests, migration roundtrip/isolation/history/concurrency tests on disposable PostgreSQL, and browser tests of signup/recovery, saves, navigation, full auxiliary-PDF access and expanded viewers. Synthetic QA judgments are never human annotation data.

## Separate work before LLM scoring

This update specifies the protocol and interface; it does not build 600 source/page packets or execute API calls. A future runner must bind the actual source snapshot and any compilation patches to each target PDF, map primary source to the physical-page window, freeze page rendering and provider/model settings, validate request coverage, and save raw requests/responses, hashes, usage/cost and run failures. Do not treat a planned nine-page cutoff as transport truncation or claim whole-paper quality from this windowed audit. No private API keys or recovery codes belong in Git.
