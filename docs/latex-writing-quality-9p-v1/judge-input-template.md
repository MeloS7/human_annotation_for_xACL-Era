# Nine-page multimodal judge request layout

This is an input specification, not an executed API request. No paid judge run or 600-paper source/page packet is created by this protocol update.

System: exact `judge-system.txt`. User: full canonical `rubric.json`, `judge-output-template.json`, and the packet below. All models receive the same source, page images, scope and supporting material. Do not provide human ratings, another model's scores, award status or early/late labels as scoring guidance.

```text
RUBRIC
{complete canonical rubric.json}
OUTPUT_TEMPLATE
{complete judge-output-template.json}

TARGET_SCOPE
packet_id: {opaque target snapshot identifier}
input_condition: source_plus_pdf_pages
scope_id: target-pdf-first9-maintext-v1
page_numbering: physical_pdf_pages_1_based
page_start: 1
page_end_inclusive: {min(9, verified actual total PDF pages)}
total_pdf_pages: {actual total}
primary_page_ids: {P01 ... through assigned end}
primary_source_block_ids: {all matching active main-paper blocks}
supporting_block_ids: {separate optional appendix/reference/context blocks}
intentional_scope_cutoff: {true only when actual PDF exceeds 9 pages}
transport_truncation_detected: {host-verified true/false}
source_pdf_binding_verified: {host-verified true/false}

SOURCE_CHECK_REPORT
{source/archive and active-file hashes, main entry, include/macro/conditional
resolution findings, compile patch provenance, target PDF hash, source-to-page
mapping and any blocks crossing the window boundary; missing mapping is a
preparation limitation, not an inferred writing defect}

PRIMARY_LATEX
BEGIN_SOURCE_BLOCK id={B01} file={project-relative file} lines={start..end} page_ids={P01,...}
{active source corresponding to scored main-paper content within the page window}
END_SOURCE_BLOCK
{all remaining in-scope blocks in manuscript order}

DEPENDENCY_AND_REFERENCE_INDEX
{needed macros, label/ref and citation-key mappings; distinguish dependencies
from primary prose. Do not silently include later manuscript content here.}

PRIMARY_PAGE_IMAGES
PAGE id=P01 physical_page=1
[actual page image attached as image_url/base64 content, not merely a file path]
{repeat through page_end_inclusive, in order and at frozen readable resolution}

SUPPORTING_MATERIAL
BEGIN_SUPPORT_BLOCK id={A01} role=auxiliary_appendix source={file:lines} page_ids={if supplied}
{declared appendix/context source, distinct from core writing; optional matching
support page images may follow with their own IDs}
END_SUPPORT_BLOCK
{declare exactly what is available, including when there is no appendix input}
```

## Preparation and coverage rules

- Keep the complete original source/PDF immutable. Bind active LaTeX, local compatibility patches and rendered pages to the same snapshot. Do not use official-conference pages as target images. The host must verify source/PDF binding and all assigned page images before releasing a completed scoring packet; unknown or failed binding is a preparation failure, not a manuscript score.
- Main-paper content in physical pages 1–9 is scored. Reference lists, appendices and later pages are auxiliary even when included for context. Full appendix reference may be supplied separately; its availability does not require full-appendix review or make its prose core-scored.
- Map source to the rendered window. The input is not simply the first N source lines. Respect include order, active conditionals, floats and text crossing page nine. Preserve environment syntax and source locations; mark out-of-window continuation rather than silently broadening the scoring scope.
- A planned nine-page window is not input truncation. Missing an assigned page or unplanned transport/context truncation is an incomplete run. Validate the actual request and response; do not infer completed coverage from a score alone.
- Attach one image per physical page with stable IDs. Freeze rendering tool/version, dimensions, content hashes, sampling settings and provider/model. Record image processing failures separately from paper defects.
- Save the full serialized request and raw response, actual usage/cost, timings, retries and output-validation result. Shared criteria do not imply identical internal model vision processing.
- This update does not implement a source-to-page builder, run inference, or assert that the source/PDF bindings for all 600 papers have been verified.
