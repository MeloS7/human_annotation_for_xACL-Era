# LaTeX writing quality: shared human / LLM protocol

**Status: implemented; production release awaits the database migration and CI verification.** Protocol ID: `latex-writing-quality-v1`; rubric: `latex-writing-quality-rubric-v1`.

本协议评价所选 arXiv 版本 LaTeX 中的正文、论述结构和技术表达，目的是判断它作为 academic writing 研究材料的内容质量。人工可通过同一源码生成的可读呈现阅读，LLM 可直接阅读 LaTeX。核心 source-only 任务可使用文本 LLM，不以视觉能力为前提。PDF 是一种呈现方式，编译成功、页面美观或与会议版完全一致都不是写作质量分数。

本次实现已新增独立的 `latex-writing-quality-v1` 存储空间；旧对齐协议和 `document-quality-v1` 的标注及历史保持归档。新协议从空白重新评分，不能自动把旧分数转换为新分数。正式启用前需要安装 `supabase/setup-writing.sql` 并通过检查。软件验证及尚未完成的发布步骤见 [`../latex-writing-quality-verification.json`](../latex-writing-quality-verification.json)。

## 1. Shared scoring object and scope

固定选定的 arXiv ID、版本号、源码文件集合、主入口和文件 SHA-256。人工可读视图和 LLM 输入必须来自这个相同的源码版本，不从官方 PDF 补写、替换或修正内容。

主评分范围包括标题、摘要、正文各节、正文中的列表、算法、表格单元格、公式、图表说明和正文引用关系。保留完整项目及参考文献、附录；主评分不要求逐条审查参考文献，也不因附录的长短或排版扣分。正文明确指向附录的必要解释，可以在预先声明的 supporting-material 范围中查阅，并记录是否使用。合理地把细节放在可取得的附录中不等于结构不完整。

不评价研究创新性、录用价值、实验证据是否达到某个会议标准、外部事实真伪或数学证明是否正确。可以评价论文本身存在的表述歧义、未定义术语以及会妨碍理解的内部前后不一致。

## 2. Five core ratings

Canonical definitions and every 1–5 anchor are in [`rubric.json`](rubric.json). 人工界面与 LLM 必须使用这同一份文件；以下中文是操作说明，不是另一个评分版本。人工可直接阅读同内容生成的英文评分表 [`rubric-for-raters.md`](rubric-for-raters.md) 和简短说明 [`human-instructions.txt`](human-instructions.txt)。

| Key | Dimension | What is assessed |
|---|---|---|
| `language_clarity` | Language Clarity & Fluency | 句子含义、措辞、语法和术语使用是否清楚；不因偏好某种英文风格而扣分。 |
| `coherence_flow` | Coherence & Logical Flow | 句段、章节和论点解释之间的衔接，读者是否能跟随论述。 |
| `structural_completeness` | Structural Completeness | 就论文类型及其自身承诺而言，主要论述是否完整、关键部分是否交代，是否有实际截断或悬空依赖。 |
| `technical_expression` | Technical Expression & Referential Clarity | 概念、符号、方法步骤、公式、源码可读的表格、说明和交叉引用是否足以理解技术表达。 |
| `overall_writing_quality` | Overall Writing Quality | 对目标源码中论文整体表达质量的直接判断。 |

统一尺度：5 = 表达清楚、内容就其范围而言完整；4 = 局部轻微问题；3 = 多处明显问题但主要内容仍可理解；2 = 严重问题妨碍理解重要部分；1 = 大部分相关内容不可理解或严重残缺。正常的风格差异不妨碍给 5 分。

每项独立按其 anchors 评分。Overall 单独判断，不计算四项均值或加权总分；其他分数、辅助检查和版本差异不自动限制它的取值。

五项均适用于学术论文；最终回答为整数 1–5 或 `uncertain`，不使用 N/A。没有图表或公式本身不扣分；Technical Expression 仍可评价概念、方法、证据说明或分析过程。

### Boundaries and special cases

- **结构完整不等于会议版覆盖率。** 不强制特定章节名或顺序，不要求每篇论文都有实验；官方版后来新增内容，不证明此版本有缺陷。
- **技术表达不等于图片视觉质量。** 源码中的 caption、公式和表格文本可以评分；只有 `\includegraphics` 路径时，不能声称已经检查图中的曲线、轴标签或数值。若某项判断确实依赖未提供的图像内容，该项用 `uncertain` 并指出缺少的材料。不能从官方版图像推断目标版图像。
- **工具失败不等于论文质量低。** 输入截断、展开失败或不支持的宏导致不可判断时，受影响维度为 `uncertain`；不得直接给 1 分。
- **真实源码缺失需要记录。** 若确认原始包本身缺少被引用的正文文件或仍有占位正文，这是源材料缺陷。按已证实的理解影响评分，未知内容不猜测；同时记录 source-integrity 问题。区分“文件确实不存在”和“文件存在但预处理工具未能读取”。
- **呈现损坏需要回到源码。** 人工 PDF 中缺字、重叠或截断时，先记辅助问题，并用同源的可读源码视图核查。无法取得可读内容时，相关核心项选 `uncertain`。不要把渲染错误自动解释为源码写作错误。
- 人工只需完成五项核心评分和阅读范围确认；不重新引入强制证据、页码或个人备注框。LLM 的简短理由和源码定位用于运行审计，不是额外质量维度。

## 3. Auxiliary checks, kept separate

### A. Source integrity (prefer deterministic checks)

单列主入口、include 依赖、条件分支处理、宏支持、label/ref、citation/bibliography key、资源文件存在性、输入截断和映射覆盖率。各项用 `pass` / `fail` / `unknown` / `not_applicable`，记录规则、工具版本及证据。静态检查不能证明一定可以编译；不支持的语法应为 unknown，而非假定失败。

这些检查不与五项核心分数相加。技术上的未解析 key 只有在其实际妨碍理解时才影响相关写作维度；不能按 warning 数量自动扣分。

### B. PDF visual integrity (optional presentation check)

如果提供目标编译 PDF，可保留单独的 Visual Integrity & Legibility 1–5 辅助评分：5 清晰完整；4 轻微缺陷但不影响阅读；3 局部缺陷影响部分阅读；2 多处重要内容难以阅读；1 大部分无法阅读。无法观察时用 `uncertain`，未提供 PDF 或未执行检查时用 `not_assessed`。

可记录 missing glyphs、overlap、clipping、unexpected blank regions、unreadable objects 等 issue。关联目标 PDF hash、渲染工具和页码。LLM 仅收到 LaTeX 时，此项必须为 `not_assessed`，不能估计 PDF 的视觉分数。人工辅助分数也不计入核心 Overall。

### C. Conference-version audit (optional, separate activity)

官方 ACL PDF 用于身份、会议版本及内容差异的独立核查，主评分请求不提供它。建议人工也先提交核心评分，再进入这一活动；保持相同的 reference-visibility 规则。版本差异另记，不用官方版替目标源码补足缺失内容，不因有差异自动降低写作质量分数。

## 4. LLM input packet

每篇论文独立请求。固定的 system instructions 位于 [`judge-system.txt`](judge-system.txt)，再提供同版本完整 `rubric.json` 和一个可追溯的 source packet。输入布局见 [`judge-input-template.md`](judge-input-template.md)。

1. **Immutable source snapshot.** 原始 arXiv source archive 和解包文件保持原样；为每个文件保存 SHA-256，记录入口及选定版本。不要把整个项目中的样例论文、旧稿、无关样式代码混入正文。
2. **Resolved LaTeX reading view.** 按固定规则展开 `\input` / `\include`，保留原章节顺序、段落、数学、算法、caption、表格和 citation/ref。可去除注释和模板噪音，但必须使用 TeX-aware 规则，正确处理转义百分号及 verbatim 等情形。保留必要宏定义；不支持的宏和条件分支明确报告，不能自行猜测其含义。
3. **Source-location map.** 为输入块赋稳定的 block ID，并映射到原始文件与行号。不要为了加行号而破坏跨行 LaTeX 语义；块标签放在包封装层。展开后的位置能回溯到原始文件。
4. **Supporting indexes.** 提供章节树、label/ref 与 citation key 映射、图表说明和资源清单，必要时附上被正文引用的 supporting material。资源清单明确区分“仅知道文件存在”和“实际向 judge 提供了图像内容”。不能把索引中的缺失项解释成已经看过的内容。
5. **Coverage gate.** 调用前检查输入预算，保存实际发送的 packet。遇到超长输入先标记 pending，再采用预先固定、可验证覆盖全部范围的分段方案；不得静默截断、用 LLM 摘要替代原文，或把少数页面/章节的分数当全文分数。传输或上下文截断时，不发布全文最终分数，重新组包或将本次结果标为不完整。

不要求把 LaTeX 改写成 TXT，也不要求生成目标 PDF。规范化视图仍保留 LaTeX 语义，并可追溯到原始代码。原始图像可在独立的 source+assets 条件中提供，但应固定所有样本的规则，并区分于 source-only 条件。

## 5. Judge output and run provenance

[`judge-output-template.json`](judge-output-template.json) 是未评分的结构模板，不是有效的已完成评估。五个 core score 填完后，`null` 应替换为 1–5 或 `uncertain`。只有确实检查完声明范围时，才能将 `reviewed_declared_scope` 设为 true。LLM 不能自行确认其上下文未被宿主截断。

`judge_audit` 每项保留一段简短解释，可提供 packet 中实际存在的 block ID。无需输出完整推理过程。宿主程序验证 key、类型、范围、block ID 和完整性；无效 JSON 或缺项是运行失败，不能伪装成论文低质量。

宿主程序另外记录 protocol/rubric/prompt/packet hash、源码版本与文件 hash、输入条件、provider、请求模型名、返回模型标识、时间、有效采样和推理参数、原始请求与响应、usage、重试以及输出验证结果。不要要求模型自己填写这些事实。API alias 可能更新；记录 metadata 不等于已经锁定了服务端权重版本，无法锁定时应说明这一复现限制。

机器结果与人工评分分别保存，并标记 `rater_type`。不得覆盖人工答案、把旧 PDF 质量分数迁移为源码写作分数，或把模型回答标为 human-validated。

## 6. Human / model calibration

先用少量论文检查规则可理解性和 source packet 覆盖，冻结 rubric、输入规则和 instructions 后，再进行独立评分。人工与 LLM 对同一个源码版本的同一声明范围打分；人工通过 PDF 阅读、模型通过 LaTeX 阅读这一呈现差异需要记录。

保留三位人工的独立评分，逐维比较模型与人工中位数的绝对误差、加权一致性，以及严重缺陷漏检。`uncertain` 单独报告比例和原因，不转换为低分，也不直接混入数值均值。五项评分各自报告，Overall 不由分项生成。

若用这 30 篇选择模型或反复调提示词，它们属于校准集；效果结论应在另行保留的样本或预先规定的评估拆分上确认。新协议仍需要试标，不能仅凭设计将其称为已验证标准。
