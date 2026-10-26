# Source-only judge request layout

Design template; this is not an API-specific request and has not sent any manuscript to a provider.

**System message:** exact contents of `judge-system.txt`.

**User message:** full canonical `rubric.json`, `judge-output-template.json`, and the source packet below. Substitute verified content for the placeholders. Do not pass earlier human ratings, award status, early/late cohort labels, or another model's scores as scoring guidance.

```text
RUBRIC
{complete contents of rubric.json}

OUTPUT_TEMPLATE
{complete contents of judge-output-template.json}

TARGET_SCOPE
packet_id: {opaque paper-and-version identifier}
input_condition: source_only
primary_scope: {title, abstract, main-paper sections and associated source-readable technical material}
primary_block_ids: {ordered list of every primary block}
supporting_scope: {explicit list of any appendix or bibliography material supplied separately}
main_entry: {verified project-relative entry point}
transport_truncation_detected: {host-verified true/false; unknown blocks finalization}

SOURCE_CHECK_REPORT
{preprocessing tool/version, include resolution, conditional resolution,
 macro support limitations, source dependencies, key mappings and coverage findings}

SECTION_TREE
{ordered section tree with source block IDs}

PRIMARY_LATEX
BEGIN_SOURCE_BLOCK id={stable block ID} file={project-relative file} lines={start..end}
{unaltered LaTeX content for this block, or a documented deterministic reading-view transformation}
END_SOURCE_BLOCK
{repeat for every primary block, in manuscript order}

DEPENDENCY_AND_REFERENCE_INDEX
{needed macro definitions, label/ref targets and citation/bibliography-key mappings}

ASSET_INDEX
{each path, existence status, associated source block/caption, and whether its
 visual content is actually supplied; existence alone does not supply pixels}

SUPPORTING_MATERIAL
{only material declared in supporting_scope; preserve source block mappings}
```

The wrapper is not inserted inside LaTeX environments. Keep mathematical, table and algorithm environments intact when choosing block boundaries. The source map preserves original file and line locations even after include expansion or comment removal.

Whole-document analysis should use all declared primary blocks. If they do not fit, mark the case pending and use a separately specified complete-coverage strategy. A short summary or selected chapters are not equivalent evidence for the same full-paper task.

For an optional `source_plus_assets` condition, attach the target snapshot's original images, associate each image with its source block ID, and record the changed input condition. They are not pages of a compiled target PDF and are not borrowed from the official version. All compared models and human conditions need the same declared scope of available evidence.

Provider adapters determine how text and optional images are carried. Freeze the actual serialized request, validate size and completion status, and retain the effective parameters. This draft makes no assumption that temperature or a seed is honored by every provider or reasoning mode.
