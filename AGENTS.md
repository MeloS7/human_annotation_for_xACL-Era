# xACL-Era human annotation website

Use the main-agent workflow supplied by the user: main agent plans and reviews; bounded implementation uses luna_worker when useful. Workers do not delegate. Preserve concurrent edits.

This repository deploys a frozen 30-paper annotation sample to GitHub Pages with Supabase persistence. Keep manifest, rubric, selection, provenance and all 60 PDFs byte-identical to the original package. Do not copy local outputs or secrets into this repository. The Supabase publishable key is a public client key; individual recovery codes and administrator credentials are private.

Keep English default, user-chosen pseudonymous nickname + anonymous Supabase Auth and personal recovery-code restoration, first-unfinished resume, autosave acknowledgments, optimistic concurrency, recovery/export/import, all eight score definitions and original completion checks. Published annotation records must be inaccessible without the participant capability. All saves retain immutable revision history with scoring-guidance version/hash. Do not relabel old local annotations as newly collected ratings.

## Current protocol (user decision, 2026-10-26)

The active protocol is `document-quality-v1`: six target-only document-quality dimensions, 1–5 plus Uncertain; only Technical Presentation permits N/A. The official PDF is an optional reference. Version differences and all notes/evidence are optional and never constrain quality scores. Completion requires six responses and review of the compiled main paper. This supersedes the previous eight-dimension requirements for the active interface.

Preserve the original manifest, PDFs, root alignment rubric/guidance and all historical alignment records byte-for-byte. New assets and records are separately versioned; never transfer even the old Visual Integrity score into the new protocol. Existing nicknames and recovery codes are reused. The new protocol starts unanswered. Keep protocol-specific local recovery isolated, and reject old/cross-protocol records. Normal annotation-data export belongs to the maintainer; participants retain only emergency private unsaved-recovery downloads. Do not deploy the new frontend before its reviewed database migration is installed.

## LaTeX writing protocol (supersedes the current-protocol paragraph above)

The user approved `latex-writing-quality-v1`: five source-level writing dimensions with 1–5 or Uncertain and no core N/A. PDF Visual Integrity is an optional auxiliary check, stored outside core scores; it never gates completion or caps Overall. Completion requires five answers and source-manuscript scope confirmation. Existing evidence/private-note panels remain removed. Keep all five core definitions and the visual definitions open by default.

Preserve both old protocol assets and records/history without copying or relabeling any rating. Reuse profile identities/recovery only; the new protocol starts blank. The frozen cohort remains unchanged. New writing metadata is under `writing-assets.json`. Main reading shows the target PDF as a same-source reading aid. The official reference and optional version audit are revealed only on request after core completion; record monotonic `reference_exposed` without claiming it proves actual reading or external access. Preserve normal/expanded synchronization when the audit is open and bottom navigation. Core edits after exposure retain that metadata. Only the maintainer exports normal records. Do not deploy before the new writing migration/health and required checks are confirmed.
