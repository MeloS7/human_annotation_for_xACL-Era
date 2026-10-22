# xACL-Era human annotation website

Use the main-agent workflow supplied by the user: main agent plans and reviews; bounded implementation uses luna_worker when useful. Workers do not delegate. Preserve concurrent edits.

This repository deploys a frozen 30-paper annotation sample to GitHub Pages with Supabase persistence. Keep manifest, rubric, selection, provenance and all 60 PDFs byte-identical to the original package. Do not copy local outputs or secrets into this repository. The Supabase publishable key is a public client key; individual recovery codes and administrator credentials are private.

Keep English default, user-chosen pseudonymous nickname + anonymous Supabase Auth and personal recovery-code restoration, first-unfinished resume, autosave acknowledgments, optimistic concurrency, recovery/export/import, all eight score definitions and original completion checks. Published annotation records must be inaccessible without the participant capability. All saves retain immutable revision history with scoring-guidance version/hash. Do not relabel old local annotations as newly collected ratings.
