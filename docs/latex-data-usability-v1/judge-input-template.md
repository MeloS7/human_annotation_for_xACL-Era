# Judge input: manuscript data usability

This specification does not run a model or construct 600 evaluation packets. Freeze the model/provider and input condition before a run. Give both models the same canonical rubric and material. Do not provide human ratings, other-model scores, award status or period labels as scoring guidance.

**System:** exact `judge-system.txt`.

**User content:** complete `rubric.json`, `judge-output-template.json`, then:

```text
TARGET
packet_id: {opaque frozen snapshot ID}
input_condition: source_plus_pdf_pages_and_resource_report
scope_id: target-pdf-first9-maintext-v1
physical_page_start: 1
physical_page_end_inclusive: {min(9, verified total PDF pages)}
total_pdf_pages: {actual total}
primary_page_ids: {P01 ... assigned end}
source_pdf_binding_verified: {host-verified boolean}
primary_input_complete: {host-verified boolean}
intentional_scope_cutoff: {true if PDF exceeds 9 pages}

SOURCE_PROVENANCE
{source archive hash, active entry/include provenance, compatibility-patch
provenance, target PDF hash, source-to-page mapping and unresolved limitations}

PRIMARY_LATEX
BEGIN_BLOCK id=B01 file={project-relative path} lines={start..end} pages={P01,...}
{active main-paper LaTeX corresponding to the scored window}
END_BLOCK
{repeat in reading order; include needed macro/label definitions in a distinct
dependency block. Do not treat comments, inactive branches or the first N source
lines as a reliable substitute for the active rendered window.}

RESOURCE_CHECK_REPORT
{report ID/hash, declared coverage and limitations, verified source binding,
asset IDs, file existence/checksums and any actual openability tests.
Mark unperformed tests not_checked. Do not invent an active dependency graph
from a static whole-project file inventory.}

TARGET_PAGE_IMAGES
PAGE id=P01 physical_page=1
[attach actual image content in provider-supported image input, not a local path]
{repeat in order through the assigned end, with frozen rendering settings}

SUPPORTING_MATERIAL
{explicitly list appendix/reference/later-page source or images if supplied;
label each auxiliary block with its ID and role, separate from primary prose.
Official PDF is normally omitted from primary scoring. If supplied for a
separate version audit, label it official_reference and record its use.}
```

Preparation must verify snapshot identity and coverage before scoring. Preserve original data; never silently repair a target to improve its score. Map source to the rendered window, respecting active includes, conditionals, floats and boundary-crossing content. Mapping failures are preparation limitations, not poor data scores. A planned window boundary is not transport truncation.

Supply actual readable page images; optionally provide object crops or verified resource previews with stable IDs when needed. A manifest/file name alone is not image evidence. A resource report for the entire source project is not proof of page-specific object completeness. Record what humans actually receive: the current site provides PDFs and a source-project inventory, while judges additionally receive active LaTeX. Shared anchors permit comparison, but representation differences and incomplete evidence must be reported rather than hidden as disagreement.

Validate output keys, four rating values, asset-only `na`, auxiliary independence, scope coverage and cited IDs. Store exact serialized requests, raw responses, hashes, model/provider/settings, inspected scope, usage/cost, timings and failures. A source-only ablation has a different input condition; it cannot assess unseen pixels and must not be pooled with multimodal ratings as identical evidence.
