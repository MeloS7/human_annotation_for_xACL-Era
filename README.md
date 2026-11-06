# xACL-Era · manuscript data usability audit

English-first annotation for the frozen 30-paper sample. The deployed human protocol is **`latex-data-usability-v1`**: four core ratings and one independent optional PDF visual check.

| Dimension | Recording |
| --- | --- |
| Text Integrity & Readability | Core, 1–5 or Uncertain |
| Document Structural Integrity | Core, 1–5 or Uncertain |
| Non-text Asset Integrity & Usability | Core, 1–5, Uncertain, or N/A for no relevant objects |
| Overall Data Usability | Core, direct judgment, 1–5 or Uncertain |
| PDF Visual Integrity & Legibility | Optional auxiliary score, independent of core completion |

Audit collected-data defects, including missing/corrupted text, damaged content ordering and unusable object representations. Do not grade the original authors' prose style, logic, scientific correctness or conference-version similarity. Expected but missing objects are defects; unavailable evidence is uncertainty. LaTeX-generated tables, equations and TikZ do not need separate image files. Overall is not an average or automatically capped score.

## Shared scope and evidence

Inspect main-paper content on physical PDF pages **1–min(9,total_pages)**, counting from the first PDF page. Full PDFs, references, appendices and later pages remain available as auxiliary reference. A planned cutoff, later conclusion and reasonable appendix deferral are not defects. No full scientific peer review or full-appendix reading is required.

The canonical rubric and human instructions live in this repository. The active LLM judge prompt package is maintained in the private [RevisionLens working repo](https://github.com/MeloS7/revision-lens/tree/g5k/pilot/prompts/latex-data-usability-v1/judge-user-v3), with its research workflow described in [`docs/llm_judge.md`](https://github.com/MeloS7/revision-lens/blob/g5k/pilot/docs/llm_judge.md); readers need access to that private repository. This annotation repository does not maintain a duplicate active judge prompt or request builder. The judge receives matching active LaTeX and ordered target-page images; humans inspect the rendered target PDF and may consult the optional resource inventory. Resource evidence, input limitations and host run metadata do not enter the judge request. Report this evidence difference when measuring agreement. The optional official-PDF version audit remains separate and opens after core completion.

The resource report is an inventory of the **whole frozen source project**, not a resolved first-nine-page dependency graph or proof of source-to-official equivalence. It records actual checks and limitations. File hashes do not prove pixel legibility or correct caption association. Static inventories may contain unused or appendix resources. Missing tests remain not_checked; unknown does not mean absent. See the report and reproducible builder for exact coverage.

## Participant workflow and persistence

Reuse existing nicknames and recovery codes. New-protocol ratings start blank. Inspect the assigned window, complete four responses and confirm the scope. All score definitions open by default. English default, autosave acknowledgment, first-unfinished resume, private unsaved recovery, bottom navigation and synchronized normal/expanded viewers remain available. Visual checks and version observations are optional. Normal data export belongs to the maintainer.

The original cohort, selection, provenance and 60 PDFs remain protected by `frozen-assets.json`. All previous protocol assets and records/history remain archived. The exact previous nine-page config is archived under `site/protocols/latex-writing-quality-9p-v1/config.json`; new metadata is locked by `usability-assets.json`. Shared identities are reused; no previous score or timestamp is relabeled. New records use a distinct protocol key and `xacl_usability_*` RPCs. Migration005 retires older write endpoints while retaining read access and historical data.

## Database and release

The database owner executes [setup-usability.sql](supabase/setup-usability.sql) after migrations001–004. It creates no participants and preserves old ratings. On a fresh installation, apply setup.sql, setup-quality.sql, setup-writing.sql, setup-writing9p.sql, then setup-usability.sql. The latest migration must remain last; archived migrations can restore old write grants if rerun afterward.

Publish only after production health agrees with the protocol/cohort/rubric/guidance hashes. Candidate `codex/**` branches run verification without deploying; only successful `main` builds deploy Pages. Verification covers frozen assets, shared metadata, old/new unit checks, migration preservation/isolation/history/concurrency on disposable PostgreSQL, and browser saves/recovery/navigation/viewers.

Maintainer export with authorized database access:

```sql
SELECT annotator_id, revision, current_record, rubric_version, rubric_sha256,
       guidance_version, guidance_sha256, saved_at
FROM xacl_private.quality_annotation_records
WHERE protocol_id = 'latex-data-usability-v1'
ORDER BY annotator_id;
```

## Before model evaluation

This repository does not call paid models, choose a provider, prepare source/page packets or certify source-to-page mappings. Those judge implementation tasks belong in the private RevisionLens working repo linked above. A scoped integrity audit supports evidence of dataset usability, not an exhaustive guarantee of intrinsic writing quality or author-version equivalence. Do not put API keys or recovery codes in Git.

## Low-score follow-up · 49 papers

The representative 30-paper sample stays at the original URL. The same site also provides a separate [49-paper follow-up](site/followup.html) for the union of GPT core scores at or below 3 or Uncertain and PDF visual scores at or below 3. Use the 30-paper ratings for representative human and model comparison and the 49-paper findings for targeted adjudication. Four exact paper versions appear in both sets and have separate review records.

Open the follow-up and continue with the same annotation profile. The browser automatically loads the selected paper's version-matched PDF from GitHub Pages and checks its bytes against the frozen manifest. Optional GPT and Gemini observations also load from Pages. For each listed issue, record Confirmed, Not found, or Insufficient evidence, with an optional category and page note. The PDF and observation files are public site assets. The participant's findings are stored in Supabase and require their profile session to read.

The 49-paper page uses `latex-data-usability-followup49-v1` and a distinct manifest and record schema. Apply [migration 006](supabase/006_followup49.sql) after migration 005 and verify both public health RPCs before deploying. Export adjudications separately by filtering `xacl_private.quality_annotation_records` on `protocol_id = 'latex-data-usability-followup49-v1'`.
