# Manuscript data integrity and usability

Protocol `latex-data-usability-v1` replaces intrinsic writing-quality scoring with a scoped audit of the collected LaTeX data. It preserves every previous protocol and starts new ratings blank.

| Dimension | Role |
| --- | --- |
| Text Integrity & Readability | Core: observed text loss, corruption, duplication and placeholders |
| Document Structural Integrity | Core: preserved content units and ordering |
| Non-text Asset Integrity & Usability | Core: usable object representations and supplied resource evidence |
| Overall Data Usability | Core: direct readiness for academic-writing research |
| PDF Visual Integrity & Legibility | Optional auxiliary check of rendered reading aids |

Core ratings use 1–5 or `uncertain`. Only non-text assets also allow `na` when no relevant objects occur in the inspected scope. Expected but missing objects are defects; unavailable evidence is uncertainty. Overall is direct, never an automatic average or cap. Original writing style, logic, scientific merit and conference-version similarity are outside the core audit.

The scope remains main-paper content on physical PDF pages 1–min(9,total_pages). Full PDF, appendix and references remain accessible as auxiliary context. The planned boundary and reasonable appendix deferral are not defects. Inspect for data problems; no full scientific review is required. Results describe this window and actual checks, not exhaustive certification of the complete source project or all 600 articles.

`rubric.json` is byte-identical to the deployed rubric. `human-instructions.txt` and `rubric-for-raters.md` explain the same anchors. The active judge input/output format is [judge-user-v3](judge-user-v3/README.md): a single user message containing the complete criteria and JSON output shape, matching active LaTeX and ordered page images. Resource evidence, input limitations and run metadata remain host-only audit information, without entering the model input. Earlier prompt versions remain archived unchanged. The current resource inventory is supporting evidence, explicitly scoped to the whole source project; it does not resolve first-nine-page dependencies, prove file legibility or establish correct figure association. Unknown checks remain unknown.

Humans currently read rendered target PDFs plus the resource report; judges additionally receive matching active LaTeX. Report this evidence difference when measuring agreement. This change does not run paid inference, select a provider/model, build all 600 source/page packets or certify their source-to-page mappings.

Report human/model agreement per core dimension and disclose inspection coverage and representation differences. Keep N/A, Uncertain and unassessed visual checks separate from numeric scores; report their counts rather than treating them as zeros or silently dropping them. Do not describe these ratings as a test of the authors' intrinsic writing quality.

The inventory can be reproduced offline from the exact frozen source/catalog tree (the builder never compiles or executes manuscript code):

```bash
python3 scripts/build_resource_audit.py \
  --project-root /path/to/frozen-revision-lens \
  --manifest site/manifest.json \
  --provenance site/sampling-provenance.json \
  --output /tmp/resource-audit.json
```

Compare that output with `site/protocols/latex-data-usability-v1/resource-audit.json`. The frozen catalog and sample provenance must match before inventory generation. The protocol guidance hash binds the report used by the interface to saved annotation revisions; it does not upgrade an unperformed check to a successful one.
