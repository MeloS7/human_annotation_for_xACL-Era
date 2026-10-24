# xACL-Era · Human PDF alignment annotation

An English-first, bilingual annotation website for independent annotators reviewing the same frozen sample of 30 paper pairs. Each pair contains a compiled arXiv LaTeX PDF (the scored target) and its official conference PDF (the reference).

The static application and the 60 public paper PDFs are hosted by GitHub Pages. Annotation records are stored privately in the supplied Supabase project. The website does not call any language or vision model.

## Annotators

1. Choose **Create profile**, enter a nickname, and save the system-generated personal recovery file. No email, password or preassigned ID is required.
2. A new profile starts at the first paper. On the same browser, **Continue** resumes the first unfinished paper and restores saved drafts.
3. On another device or after clearing browser data, choose **Restore profile** and enter your nickname and personal recovery code.
4. Ratings save automatically. Wait for **Saved** before closing or changing device. If saving fails, keep the page open and download recovery JSON.
5. Export your own saved annotation JSON when finished. The recovery file and annotation JSON are different files: the first restores account access, while the second contains your ratings.

The page defaults to English. 中文 remains available. Different publisher-added proceedings information, copyright notices and page numbering do not by themselves lower alignment scores; the scoring guide explains scope and exceptions.

Figure, table, and equation scores include their presence decisions directly. **N/A** confirms that the type is absent from both main papers. **1** requires a reason: missing from the compiled PDF, added only in the compiled PDF, or largely non-corresponding content. Partial omissions use the existing severity anchors. All eight score definitions open by default. All annotators enter the current scoring interface directly. Earlier pre-study test rows automatically restart only the figure, table, and equation ratings; existing current-protocol ratings are retained.

## Coordinator setup and deployment

Supabase Anonymous Sign-Ins must be enabled. The URL and publishable client key in `site/config.json` are public settings, not administrator credentials. Run `supabase/setup.sql` as the project database owner once to create this study's private tables and authenticated RPC functions. It creates **no predefined annotators or recovery codes**. Reapplying the migration preserves data and checks the frozen study identity.

The integrated scoring update also requires this reviewed setup script on an existing deployment. It upgrades only the recognized previous guidance configuration, preserves saved records and immutable history, and rejects unknown configuration drift. Apply the database upgrade before publishing its matching frontend. See [the scoring protocol and upgrade notes](docs/integrated-scoring.md).

Profiles are created by participants through Supabase anonymous authentication. The site generates a cryptographically random personal recovery code; the database retains only its digest. No fixed user-count limit or assigned ID list is imposed by this application. Normal Supabase plan and rate limits still apply.

GitHub Pages deploys only the `site/` artifact via `.github/workflows/pages.yml`; set Pages source to **GitHub Actions**. The database and published frontend must share the frozen manifest, rubric, guidance and auth-mode configuration before annotation is enabled.

## Persistence and study identity

- Private participant, current-record and immutable revision-history tables have row-level security enabled and direct access revoked from public browser roles.
- Narrow RPC functions authorize each request using the signed anonymous Supabase user identity and its private profile binding. A second device can join the same profile only by proving the personal recovery code. Merely knowing a nickname or the publishable key is insufficient to read or change ratings. Recovery codes are never included in annotation JSON.
- Writes use optimistic revision checks and serialize per participant. A stale browser receives a conflict instead of overwriting a newer revision. Every successful save/import retains the full previous history and records the exact scoring-guide version and hash.
- The original local v1 annotation JSON schema remains compatible. Its rubric and manifest binding are unchanged. Legacy imports are identifiable as imports; importing them does not retrospectively certify which guidance the original annotator saw.
- New annotation rows identify `scoring_protocol: "integrated-presence-v1"` and store a separate `object_score_reasons` value for each object type. Their retained presence fields are derived from the explicit score/reason choice and validated by the database. Earlier pre-study test rows are reset to unanswered object ratings under the current protocol on session entry, import, or recovery; no old object judgment is relabeled as a new one. Other scores and notes are retained, and normal revision history preserves earlier saves. Guidance changes are versioned; previous guidance bytes remain archived.
- Browser recovery copies are separate from server-confirmed saves. A recovery code is kept only in memory while displayed or entered, and in the participant's separately downloaded recovery file. The official SDK persists its anonymous authentication session in browser storage and refreshes tokens; the recovery code is not stored there.

Registration uses anonymous Supabase Auth with self-chosen nicknames and no personal information. A leaked recovery code lets another device access that profile, so participants should keep it private. A coordinator can revoke a profile without deleting its revision history. No privileged Supabase key belongs in the frontend or repository.

## Frozen sample and interpretation

`frozen-assets.json` locks the manifest, original rubric, current UI guidance, selection/provenance and all 60 PDFs. The cohort is unchanged from the local annotation package: early15 / late15, three papers per research area across ten areas. Sampling did not select by observed alignment quality. Original retrieval information and byte hashes remain in the manifest and provenance.

Scores apply to the compiled target. Six alignment dimensions, directly judged Overall Alignment, and target-only Visual Integrity & Legibility retain the original definitions. This interface performs no automatic scientific-content acceptance and computes no invented weighted score. Three raters on 30 papers still provide 30 paper units, not 90 independent papers; model selection using these ratings is calibration, not an independent test.

The official PDF is the exact canonical Anthology file at the recorded retrieval time; original-versus-corrected publication edition was not separately established.

## Verification

```bash
python3 scripts/verify_site.py
XACL_DISPOSABLE_DATABASE=1 bash scripts/test_database.sh  # disposable PostgreSQL only
node --test tests/frontend*.mjs
```

The browser regression uses a disposable PostgreSQL database and a local test bridge under the same project subpath as Pages. See `docs/verification.md`. It uses synthetic software fixtures and does not modify or collect human alignment judgments.

The original local offline package remains separate and unchanged. No `outputs/` directory or existing annotator answers is published in this repository.
