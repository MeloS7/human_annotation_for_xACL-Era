# Nine-page writing quality: shared human / multimodal-judge protocol

Protocol: **latex-writing-quality-9p-v1**. Scope: **target-pdf-first9-maintext-v1**. This is separate from full-scope `latex-writing-quality-v1`; all earlier assets, ratings, identities and history are preserved. No old scores are converted.

核心范围为目标 PDF 第1至 min(9, 总页数) 个物理页面内的正文，包含标题、摘要和范围内图表公式的技术表达。页码从 PDF 首页计数，不采用论文集印刷页码。不因第9页处的段落、公式、表格续写、窗口外结论或合理的附录承接扣分；结构完整性只描述已观察窗口。

网页继续提供完整 PDF 和附录浏览。参考文献、附录（即使出现在前9页）及后续页面仅作辅助参考，不评价它们的写作，也不要求读完整附录才能完成。模型使用对应正文 LaTeX + 同源前至多9页图片；附录单独置于 supporting-material 区域，可按需查阅并记录。模型之间固定同样的输入包，人工与模型使用同一份 rubric，阅读呈现形式另记。模型输出记录实际查阅的辅助块；当前人工网页不声称追踪附录实际阅读。

## Canonical files

- `rubric.json`: shared five dimensions and all 1–5 anchors; byte-identical to the active website rubric.
- `human-instructions.txt`: concise English participant instructions.
- `rubric-for-raters.md`: generated readable English definitions and anchors.
- `judge-system.txt`: exact multimodal system prompt.
- `judge-input-template.md`: source + ordered page image + optional appendix input contract.
- `judge-output-template.json`: unscored JSON shape; not a model result.

五项维度保持 Language Clarity & Fluency、Coherence & Logical Flow、Structural Completeness、Technical Expression & Referential Clarity、Overall Writing Quality。每项1–5或Uncertain，无核心N/A。Overall直接判断，不求平均；PDF视觉质量与会议版本差异是独立辅助项，不自动影响核心分或完成状态。

## Publication and data handling

New database setup: `supabase/setup-writing9p.sql`, after migrations001–003. New RPC namespace: `xacl_writing9p_*`; new records use `xacl.latex-writing-9p-annotations.v1`. The protocol identity fixes the page-window policy; `reviewed_full_scope` now means the assigned window, not the full article/appendix. Old record/history rows are not relabeled or copied. Existing profiles and recovery codes are reused.

Keep the original cohort and all60 PDFs byte-identical. Viewing a complete file does not broaden the scoring window. Source/PDF mapping, rendered image preparation, API execution and actual600-paper quality results are separate future run artifacts; they are not generated or claimed verified by this documentation/interface update.

Do not publish the frontend before the production nine-page health endpoint matches the reviewed protocol/rubric/guidance hashes. No API key is required to read these instructions; production schema changes require the database owner's SQL execution.
