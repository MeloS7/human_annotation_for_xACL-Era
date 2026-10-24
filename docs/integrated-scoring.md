# Integrated figure, table, and equation scoring

Guidance: `alignment-guidance-20261024-v3`. Protocol: `integrated-presence-v1`.

The frozen 30 paper pairs, manifest, rubric version, and eight research dimensions remain the same. The updated guidance combines the former six independent presence questions with the three object scores. It makes score 1 reasons explicit and records the protocol. All annotators use this current interface directly.

## Annotator behavior

There is no separate Item presence section. Each figure, table, or equation card offers scores 1–5, N/A, and Uncertain. All eight score definitions open by default.

| Choice | Additional choice | Saved compiled presence | Saved official presence |
| --- | --- | --- | --- |
| No score yet | None | `null` | `null` |
| N/A — absent from both main papers | None | `absent` | `absent` |
| 1 | Missing in compiled | `absent` | `present` |
| 1 | Added in compiled | `present` | `absent` |
| 1 | Largely non-corresponding | `present` | `present` |
| 2–5 | None | `present` | `present` |
| Uncertain | None | `uncertain` | `uncertain` |

A score of 1 without a reason can be saved as an unfinished draft; both presence values remain null until a reason is chosen. It cannot be marked complete. Other scores clear any previous score 1 reason. The Uncertain mapping indicates that presence was not separately elicited; it must not be analyzed as a confirmed physical absence.

Missing or adding only part of an object type does not automatically produce a score of 1. Use the original 2–4 severity anchors and page evidence. A low object score does not automatically set Overall. Existing evidence, full-scope confirmation, and Critical Difference requirements still apply.

## Saved representation

The outer record schema remains `revisionlens.alignment-annotations.v1`. New annotation rows add exactly two fields:

```json
{
  "scoring_protocol": "integrated-presence-v1",
  "object_score_reasons": {
    "figure": "missing_in_compiled",
    "table": null,
    "equation": null
  }
}
```

These are additional fields alongside the existing scores, objects, evidence, notes, flags, full-scope confirmation, status, and timestamp. The example is a schema illustration, not a participant judgment. Each reason is null or one of `missing_in_compiled`, `added_in_compiled`, or `non_corresponding`. Non-null reasons apply only to score 1. The database rejects inconsistent score, reason, and presence combinations, including during draft saves.

## Pre-study test records

The study coordinator confirmed that no real annotators used the previous recording workflow. The interface therefore has no legacy notice, read-only object ratings, migration button, or migration confirmation dialog.

On session entry, old JSON import, or local recovery, a known earlier-format test row automatically restarts only its three object scores and presence fields. It receives the current protocol and blank reasons, returns to draft, and clears full-scope confirmation. The other five scores, evidence, notes, flags, and identity are retained. Earlier saved versions remain in immutable server history. Completed status is not carried over because the three object ratings need fresh responses.

The transformed record is saved using the normal revision checks and recovery behavior. Existing pending local recovery must not be overwritten by a background conversion. Records already using the integrated protocol are unchanged, so reopening a paper never erases current ratings. An unsupported or partially extended format is rejected rather than guessed into a valid record.

This is a change to treatment of pre-study test data, not a change to the scoring criteria or stored protocol. The v3 guidance bytes and database metadata remain unchanged. The superseded transition-only paragraph titled “Previously saved ratings” is omitted from the current interface; the frozen source remains available for auditing.

## Database upgrade and deployment

1. Finish and verify the implementation against a disposable PostgreSQL database. Never run software test fixtures on the production project.
2. Review `supabase/setup.sql`, then run it in the Supabase SQL Editor as the database owner. It supports a fresh installation and the exact recognized previous guidance configuration. Unexpected study, manifest, rubric, or guidance metadata must fail with rollback.
3. Confirm that `xacl_annotation_health` returns the guidance version and SHA-256 in `site/config.json`.
4. Publish the matching GitHub Pages frontend. An outdated frontend is blocked by the guidance identity check instead of mislabeling new saves.
5. Verify the live interface with authorized test data. Keep software fixtures separate from research annotations.

No annotation records or revision-history entries are rewritten by the configuration upgrade. The prior guidance bytes remain in `site/archive/guidance-alignment-guidance-20261022-v2.json`. The manifest, PDF, and original rubric checksums remain frozen.
