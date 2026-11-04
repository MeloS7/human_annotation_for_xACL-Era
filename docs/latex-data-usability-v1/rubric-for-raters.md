# Shared rating anchors

Four core ratings; Overall Data Usability is a direct judgment, not an aggregate. PDF visual quality is a separate optional fifth dimension, never included in or automatically capping core ratings.

Scope: main-paper data on physical pages 1–9 (all pages if shorter). Full PDFs/appendices are auxiliary. Audit collected-data defects, not native writing quality.

## Text Integrity & Readability

Check whether collected active text is readable and free of observed loss, corruption, accidental duplication, unresolved placeholders or preprocessing damage. Do not grade the original author's style, grammar, eloquence or argument.

1. Most in-scope text is missing or corrupted and cannot be used.
2. Large or repeated text losses/corruption make substantial portions unusable.
3. Localized substantive text damage requires meaningful repair before reuse.
4. Small isolated data defects need minor repair; most text is directly usable.
5. No data-related text loss or corruption is observed in the inspected scope; the text is readily usable.

Uncertain: material evidence gaps prevent a defensible judgment.

## Document Structural Integrity

Check preservation and readable ordering of observed sections, paragraphs, lists and content units. Look for broken boundaries, omitted/repeated units or disordered includes. Assess data structure, not logical strength, preferred organization or whether every full-paper section appears within nine pages.

1. The observed document organization is largely lost or unusably scrambled.
2. Major missing, repeated or disordered structural units prevent reliable reuse of substantial content.
3. Localized broken boundaries or missing/reordered units need meaningful structural repair.
4. A minor isolated structural defect needs small repair; observed units remain usable.
5. Observed content units and their order are intact, with no data-related structural defect detected.

Uncertain: material evidence gaps prevent a defensible judgment.

## Non-text Asset Integrity & Usability

Inspect in-scope figures, tables, display equations and diagrams: supplied resource/source representation, readable content, and association with their source/caption. LaTeX-generated tables, equations and TikZ objects need no separate image file. A file hash proves identity, not legibility, correct association or complete coverage. Do not require reproducing numbers or images from a different conference version.

1. Most expected in-scope non-text content is demonstrably absent, corrupted or unusable.
2. Major or repeated object/resource defects make substantial technical material unusable.
3. A substantive localized object/resource defect needs meaningful repair.
4. A small isolated object/resource defect needs minor repair; relevant content remains usable.
5. Inspected objects are usable and supplied checks support their representation; no non-text defect is observed. This is not a completeness guarantee for unverified dependencies.

Uncertain: material evidence gaps prevent a defensible judgment.

N/A: No relevant non-text objects in the inspected main-paper scope. Not for missing expected resources or unavailable evidence.

## Overall Data Usability

Directly judge whether the collected in-scope LaTeX manuscript content is usable as academic-writing research data, considering confirmed data defects and evidence limitations. Do not score native writing quality, novelty, factual correctness or conference-version similarity. This is a direct judgment, not a mean, weighted total, minimum or automatically capped score.

1. The inspected manuscript data is largely unusable for the intended writing task.
2. Extensive data repair is needed before substantial in-scope content can be used.
3. Meaningful but localized data repair is needed before reliable reuse.
4. Usable with minor data cleanup; most inspected content can be reused directly.
5. Directly usable within the declared scope, with no material data-repair need observed. This does not certify unobserved pages or scholarly writing quality.

Uncertain: material evidence gaps prevent a defensible judgment.

## PDF Visual Integrity & Legibility

Optional fifth dimension: inspect rendered target pages for missing glyphs, overlap, clipping, unexpected blanks and unreadable objects. This checks the reading aid, not intrinsic writing quality, and never gates or caps core ratings.

1. Most displayed content cannot be read normally.
2. Multiple important displayed parts are difficult or impossible to read.
3. Localized rendering defects impede reading of some displayed content.
4. Minor visual defects do not materially impede reading.
5. The inspected target PDF is visually intact and legible.

Not assessed is allowed and does not block completion.
