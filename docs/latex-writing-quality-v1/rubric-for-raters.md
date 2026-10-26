# Shared writing-quality anchors

Protocol rubric: `latex-writing-quality-rubric-v1`. These definitions are copied exactly from the canonical [rubric.json](rubric.json); they apply to both human and model ratings.

Use 1–5 or Uncertain for each of the five core dimensions. No core N/A is used. PDF visual quality is a separate optional check. Overall is a direct judgment, not an average.

## Language Clarity & Fluency

Assess sentence-level comprehensibility, wording, grammar and clear use of terminology in the target manuscript. Scientific truth and preference for a particular English style are outside this dimension.

| Score | Definition |
|---|---|
| 1 | Most of the relevant prose is unintelligible or too ambiguous to recover its meaning. |
| 2 | Frequent severe wording or grammatical problems obscure important meanings across substantial passages. |
| 3 | Recurring unclear, ambiguous or awkward passages require substantial rereading or reader reconstruction, although the main meanings can be recovered. |
| 4 | A few localized wording, grammar or terminology problems require minor clarification; the main meanings remain readily understandable. |
| 5 | The prose is clear and fluent, with sufficiently precise wording for its purpose. Harmless stylistic differences or minor copyediting preferences do not reduce this score. |

## Coherence & Logical Flow

Assess how sentences, paragraphs, sections, claims and supporting explanations connect within the target version. Judge whether the communicated argument can be followed, not whether its scientific claims are true.

| Score | Definition |
|---|---|
| 1 | The manuscript lacks a recoverable main line of exposition; most connections cannot be followed. |
| 2 | Major disconnections, unexplained jumps or internal contradictions block understanding of important parts of the exposition. |
| 3 | Repeated weak transitions, unexplained dependencies, repetition or inconsistent exposition require the reader to reconstruct important connections. |
| 4 | The exposition is followable, with a few local jumps, repetitions or weak transitions that need minor revision. |
| 5 | Ideas and supporting explanations progress coherently; the reader can follow the main line without supplying missing connections. |

## Structural Completeness

Assess whether the manuscript supplies a complete account for its paper type, stated aims and own content dependencies. Do not assess coverage of the conference version or demand a particular section template.

| Score | Definition |
|---|---|
| 1 | The target account is severely fragmented, with most essential narrative content demonstrably absent or replaced by placeholders. |
| 2 | Major missing, truncated or unfinished parts prevent understanding of the problem, approach, analysis or other essential account appropriate to this paper. |
| 3 | Several substantive narrative gaps or dangling dependencies leave parts incomplete, although the central account can still be reconstructed. |
| 4 | The principal account is complete; a few local omissions or organizational gaps need minor clarification. |
| 5 | The manuscript presents a complete, navigable account for its stated scope and paper type, without material narrative gaps. Valid detail in supplied supporting material is acceptable. |

## Technical Expression & Referential Clarity

Assess the clarity of concepts, definitions, symbols, methods, steps, mathematical explanations, source-readable tables, captions and cross-references. This is communication of technical material, not proof of correctness or evaluation of unsupplied image pixels.

| Score | Definition |
|---|---|
| 1 | Most of the essential technical account cannot be interpreted because its expressions, definitions or referential links are missing or uninterpretable. |
| 2 | Major undefined concepts or symbols, ambiguous steps or broken explanatory dependencies prevent understanding of important technical content. |
| 3 | Recurring insufficient definitions, ambiguous notation, unclear captions or unexplained links require substantial reader inference. |
| 4 | The key technical account is understandable; a few local definitions, explanations or referential links need clarification. |
| 5 | Technical concepts and relevant expressions are sufficiently defined and explained; the supplied methods, notation and referential links support clear understanding within the declared scope. |

## Overall Writing Quality

Directly judge the target manuscript as clear, coherent and sufficiently complete scientific writing suitable for use as an academic-writing research document. Do not average component scores or require scientific novelty, perfect typesetting or agreement with another version.

| Score | Definition |
|---|---|
| 1 | The manuscript is largely unusable as an understandable scientific account because of pervasive writing or confirmed content-completeness problems. |
| 2 | Serious writing or content-completeness problems require substantial rewriting or restoration before the main account is understandable. |
| 3 | The main account is usable, but noticeable writing or narrative problems require substantial reader reconstruction or meaningful revision. |
| 4 | The manuscript is clear and usable overall, with localized writing issues needing minor revision. |
| 5 | The manuscript communicates a clear, coherent and sufficiently complete scientific account for its stated purpose and scope. Minor stylistic preferences do not reduce this score. |

## Uncertain

Use Uncertain when missing or unreadable evidence, a preprocessing limitation or insufficient context prevents a defensible judgment. It is not a low score. Do not report a completed whole-paper assessment from a truncated input.

## Optional PDF visual check

This check requires observation of the target PDF. It does not contribute to the five writing scores. Without a target PDF, record not_assessed.

1. Most displayed content cannot be read normally.
2. Multiple important displayed parts are difficult or impossible to read.
3. Localized rendering defects impede reading of some displayed content.
4. Minor visual defects do not materially impede reading.
5. The inspected target PDF is visually intact and legible.
