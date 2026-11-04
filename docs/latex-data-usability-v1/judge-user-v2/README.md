# Single-user-message judge prompt

This is prompt transport/output version `judge-user-v2`. It uses the unchanged `latex-data-usability-v1` grading rubric and does not create a new human annotation protocol or migrate ratings.

The application sends exactly one `user` message. It adds no custom `system` or `developer` message and does not manually rewrite the provider's chat template. This is a controlled input-format choice, not evidence that all models perform worse with a system message. DeepSeek-R1 explicitly recommends putting instructions in the user prompt; Qwen3-Omni's evaluation settings also omit a system message. Model-specific deployment requirements must still be checked for the selected endpoint. Sources: [DeepSeek-R1 model card](https://huggingface.co/deepseek-ai/DeepSeek-R1#usage-recommendations), [Qwen3-Omni evaluation settings](https://github.com/QwenLM/Qwen3-Omni#setting-for-evaluation).

`prompt-template.txt` contains the complete model-facing text: instructions, all canonical English definitions and 1–5 anchors, a literal JSON response shape, and slots only for this paper's LaTeX, resource evidence, limitations and page count. It does not ask a model to open `rubric.json` or an output-template filename. Those files are assembly inputs on our computer; their relevant contents are expanded into the message itself.

The user message's `content` array begins with that expanded text. Each actual page image follows its short physical-page label, in order from 1 through min(9,total_pages). Images are embedded as data URLs, not supplied as inaccessible local paths. See the provider's [image-input guide](https://openrouter.ai/blog/tutorials/send-image-to-llm/) for the content-array format. Check image-count limits for the chosen model/provider before running.

| Sent to the judge | Kept only in our local run record |
| --- | --- |
| Task, scope, complete shared rating anchors and response shape | Paper/run IDs, protocol/prompt/rubric versions and hashes |
| Matching active main-paper LaTeX and required definitions | Archive/PDF/image/request hashes and preparation checks |
| Ordered target page images with physical page numbers | Provider/model settings, timing, token usage, cost, retries |
| This paper's resource filenames and actual availability/openability results | Resource provenance, filesystem paths and full audit artifacts |
| Material evidence limitations the judge needs to interpret | Human ratings, other-model scores, awards and cohort labels |

Source filenames that identify a referenced object and physical page numbers are useful reading context. Checksums, byte counts and run identifiers are not. The assembler projects resource evidence to `file`, `availability` and `openability`; it does not transmit the complete 30-paper inventory. The declared inventory scope remains the whole source project and does not imply page-specific completeness or visual legibility.

The response contains four core `{score, reason}` entries, one separate visual `{score, reason}` entry and a limitations array. Core scores allow 1–5 or `uncertain`; only non-text assets also allow `na`. The visual score additionally allows `not_assessed`, with no separate status field. Null values in the displayed shape are unscored placeholders and are invalid finished responses. No identity/version/hash fields need to be echoed by the model. A host program associates the raw response with its run record instead.

The prior `../judge-system.txt`, `../judge-input-template.md` and `../judge-output-template.json` remain unchanged as the archived first transport/output version. They are not sent alongside this version.

The offline assembler does not call a model, compile LaTeX, resolve active includes, or establish source-to-page correspondence. It requires a prepared packet with explicit successful source/PDF and window-mapping checks, then checks its declared scope and page files. The preparation flags are host assertions, not independently verified findings. Real packets for 600 papers still require preparation before inference.

Rebuild the complete readable template, or assemble an already prepared paper packet:

```bash
python3 scripts/build_judge_request.py --render-template
python3 scripts/build_judge_request.py packet.json --out-dir .runtime/judge-user-v2/paper
```

The output directory contains `messages.json` (the actual one-user-message input, including embedded image bytes), `prompt.txt` (a readable preview with image-attachment markers), and `record.json` (host-only provenance and preparation information). Existing outputs are never overwritten. Add the selected API `model` and generation settings outside `messages`; those are API parameters, not extra instructions for the judge. The prepared-message hash is not a claim that an HTTP call has occurred. Token usage, cost and response metadata can only be recorded after an actual call.
