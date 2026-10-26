# xACL-Era · Document quality annotation

An English-first, bilingual website for independent annotators reviewing a frozen sample of 30 compiled arXiv papers. The official conference PDF is an optional reference. The current protocol is **document-quality-v1**.

## What is scored

Rate the compiled version itself using 1–5, or **Uncertain** if assessment is blocked. All six score definitions open by default.

| Dimension | Scope |
|---|---|
| Language Clarity & Fluency | Sentence-level clarity, grammar and terminology |
| Coherence & Logical Flow | Connections between sentences, paragraphs and explanations |
| Structural Completeness | A complete, navigable account appropriate to the paper type |
| Technical Presentation | Applicable figures, tables, equations, captions and their links to the text |
| Visual Integrity & Legibility | Legibility, glyphs, overlap, clipping, corruption and abnormal blank areas |
| Overall Document Quality | Direct judgment of clarity, coherence and usability; no calculated average |

Only Technical Presentation permits **N/A**, when the compiled main paper has no applicable technical objects. An object added to a different version does not automatically make this version defective. A missing object explicitly referenced within the compiled version is a document-quality issue. Scientific novelty and proof of scientific correctness are outside this task.

Version differences are separate, optional observations. Changed experiments, numbers, figures or sections in the official version do not cap or automatically reduce any quality score. Empty version observations mean **not assessed**, not confirmed equality. Version notes are optional, including for low or Uncertain scores. The participant UI no longer offers evidence/page-reference or private-note fields; values already stored in those record fields are preserved when scores or version observations are edited and saved.

Completion requires six responses and confirmation that the compiled main paper was reviewed. A score of 1 does not require a special explanation. The official PDF does not need a complete alignment review.

## Annotator workflow

1. Create a pseudonymous nickname and save the generated personal recovery code. Existing nicknames, device sessions and recovery codes continue to work.
2. Start the new protocol with all scores unanswered and 0/30 completed. No earlier score, including Visual Integrity, is copied into this protocol.
3. Scores save automatically. Wait for **Saved** before closing or changing device. Continue on the same browser resumes the first unfinished paper in this protocol.
4. On another device, restore using the same nickname and recovery code. The code is not stored in annotation records.
5. Use the bottom Previous/Next controls after reviewing a paper. Moving to another paper preserves its draft; only **Mark paper complete** marks it completed.

**Sync page turns** starts off. When enabled, either PDF's arrows move both viewers by one page relative to their own current pages, clamped independently to each PDF's first/last page. Direct page-number entry, zoom and Fit remain independent. The same switch stays available in the expanded viewers' toolbar, including while scrolling on mobile. Return to annotation or Escape exits expanded mode without changing either page or the switch setting.

Normal annotation-data export is a maintainer operation. The browser retains emergency private downloads for unsaved recovery only. Recovery storage is namespaced by protocol; an older alignment backup is neither applied nor deleted by the quality interface.

## Preserve the alignment archive

The original alignment rubric, guidance, sample manifest, provenance, selection and all 60 PDFs remain byte-identical under `frozen-assets.json`. The legacy configuration is also preserved at `site/protocols/alignment-v1/config.json`. The unchanged sample manifest's `rubric_version: alignment-rubric-v1` describes its original sampling package; the active scoring rubric is independently identified in `site/config.json`.

The original `xacl_private.annotation_records` and `annotation_history` remain in place. Their answers, revisions, timestamps and instruction hashes are not migrated or relabeled. Installing the quality migration revokes the old browser save RPC so a cached alignment frontend cannot overwrite archived answers.

New quality records and immutable history are stored separately in `xacl_private.quality_annotation_records` and `quality_annotation_history`, bound to `protocol_id`, the frozen cohort, and the new rubric/guidance versions and hashes. Nicknames and authenticated device bindings are shared; annotation payloads are not.

Old alignment JSON cannot be imported as quality ratings. Existing alignment scores remain version-audit observations, not retrospective writing-quality judgments.

## Database upgrade and deployment

The Supabase project already used by this website must retain Anonymous Sign-Ins. `site/config.json` contains a public publishable client key, never an administrator credential.

**Before publishing the new frontend**, execute `supabase/setup-quality.sql` as database owner in the project's SQL Editor. It is the reviewed bundle of `supabase/002_document_quality.sql`. It requires the existing alignment schema, creates no identities or recovery codes, preserves old data, and starts quality records unanswered. Reapplying it is idempotent; unknown protocol metadata is rejected.

For a new database, apply the original `supabase/setup.sql` first, followed by `supabase/setup-quality.sql`. The quality migration must be the final step because the original setup reinstates the legacy API permissions.

`xacl_quality_annotation_health` must match the active protocol, rubric, guidance and cohort hashes before scoring is enabled. The frontend fails closed instead of falling back to the alignment API. GitHub Pages deploys only `site/` after verification; branch checks do not publish a preview automatically.

## Maintainer access and verification

Participant records are private, protected by authenticated anonymous-user bindings, revocation checks, row-level security and narrow RPCs. Concurrent saves use optimistic revisions. Immutable history retains every saved quality revision with its protocol and scoring metadata.

Maintainers export through their privileged database connection or Supabase SQL Editor. For example:

```sql
SELECT protocol_id, annotator_id, revision, current_record, saved_at
FROM xacl_private.quality_annotation_records
ORDER BY annotator_id;
```

History and the separate alignment archive can be exported by the maintainer in the same way. No privileged credential belongs in browser code, the public repository, or annotation files.

```bash
python3 scripts/verify_site.py
python3 tests/backend_setup.py
python3 tests/quality_backend_setup.py
node --test tests/frontend*.mjs
XACL_DISPOSABLE_DATABASE=1 QA_DATABASE_URL=... python3 tests/quality_upgrade.py
XACL_DISPOSABLE_DATABASE=1 QA_DATABASE_URL=... node tests/browser_quality.cjs
```

Use disposable databases for test fixtures, never the real annotation database. See `docs/verification.md` for environment requirements. The original `tests/browser.cjs` documents the historical alignment interface; the active browser regression is `tests/browser_quality.cjs`.

The frozen cohort remains early15/late15, three papers per research area across ten areas. Protocol changes do not resample papers or validate all 600 source articles. Three raters on 30 papers still provide 30 paper units; choosing an automatic judge using these ratings is calibration, not an independent test.
