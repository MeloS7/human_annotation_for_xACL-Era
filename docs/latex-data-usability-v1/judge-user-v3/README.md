# Manuscript-only judge input

Active prompt transport version: `judge-user-v3`. The shared `latex-data-usability-v1` grading rubric, its five dimensions and 1–5 anchors, and the v2 response shape are unchanged.

The judge receives one user message containing the complete instructions, shared English criteria, literal JSON response shape, corresponding active main-paper LaTeX, and ordered images of physical target pages 1 through min(9,total_pages). The only text-template slots are `PRIMARY_LATEX` and `PAGE_COUNT`. No custom system/developer message is added.

Resource evidence and input limitations are **not provided as auxiliary judge inputs**. If supplied to the offline assembler, `resource_evidence` and `input_limitations` are optional host-only audit fields retained in `record.json`; omitting them is valid. Changing those fields must not change `messages.json` or the model-facing prompt. This prevents the judge from receiving program-provided audit cues absent from the intended human PDF-reading task. Source-package file audits remain separate from the common scoring task.

The `limitations` array in the response remains available for the judge's own observations about the supplied manuscript material. It is not an injected input checklist. Missing pages, invalid images or unsuccessful preparation assertions are rejected by the assembler before inference.

Shared criteria do not mean identical reading representations: the judge still receives the previously agreed LaTeX plus page images; humans mainly read the rendered PDF. The human interface's optional resource inventory has not been removed by this prompt-only change. Do not claim a controlled identical-input comparison based on these materials.

```bash
python3 scripts/build_judge_request.py --render-template
python3 scripts/build_judge_request.py packet.json --out-dir .runtime/judge-user-v3/paper
```

The output contains `messages.json` (actual user content with embedded image bytes), `prompt.txt` (readable preview), and `record.json` (host-only audit information). The selected model and generation settings belong in the API envelope and local run record. The assembler does not call a model, compile LaTeX, or independently verify source-to-page mappings; it consumes successful preparation assertions and validates the declared page window and files.

The prior v1 and v2 prompt files remain archived unchanged. Use their corresponding Git revisions to reproduce their exact assembly behavior. Human annotations and database records are not migrated by this change.
