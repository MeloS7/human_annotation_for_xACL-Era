# xACL-Era human annotation website

Use the main-agent workflow supplied by the user: main agent plans and reviews; bounded implementation uses luna_worker when useful. Workers do not delegate. Preserve concurrent edits.

This repository deploys a frozen 30-paper annotation sample to GitHub Pages with Supabase persistence. Keep manifest, rubric, selection, provenance and all 60 PDFs byte-identical to the original package. Do not copy local outputs or secrets into this repository. The Supabase publishable key is a public client key; individual recovery codes and administrator credentials are private.

Keep English default, user-chosen pseudonymous nickname + anonymous Supabase Auth and personal recovery-code restoration, first-unfinished resume, autosave acknowledgments, optimistic concurrency, recovery/export/import, all eight score definitions and original completion checks. Published annotation records must be inaccessible without the participant capability. All saves retain immutable revision history with scoring-guidance version/hash. Do not relabel old local annotations as newly collected ratings.

## Current protocol (user decision, 2026-10-26)

The active protocol is `document-quality-v1`: six target-only document-quality dimensions, 1–5 plus Uncertain; only Technical Presentation permits N/A. The official PDF is an optional reference. Version differences and all notes/evidence are optional and never constrain quality scores. Completion requires six responses and review of the compiled main paper. This supersedes the previous eight-dimension requirements for the active interface.

Preserve the original manifest, PDFs, root alignment rubric/guidance and all historical alignment records byte-for-byte. New assets and records are separately versioned; never transfer even the old Visual Integrity score into the new protocol. Existing nicknames and recovery codes are reused. The new protocol starts unanswered. Keep protocol-specific local recovery isolated, and reject old/cross-protocol records. Normal annotation-data export belongs to the maintainer; participants retain only emergency private unsaved-recovery downloads. Do not deploy the new frontend before its reviewed database migration is installed.
