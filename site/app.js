import { assertHostedHealth, createHostedAdapter, loadHostedAssets, randomRecoveryCode } from "./cloud.mjs?v=20261026-quality-v1";
import {
  QUALITY_PROTOCOL_ID, QUALITY_RECORD_SCHEMA, QUALITY_SCORE_KEYS, VERSION_DIFFERENCE_KEYS,
  blankQualityAnnotation, qualityAnnotationErrors, qualityRecordIssue,
} from "./quality-protocol.mjs?v=20261026-quality-v1";

const SCORE_KEYS = QUALITY_SCORE_KEYS;
const FLAG_KEYS = VERSION_DIFFERENCE_KEYS;
const RECORD_SCHEMA = QUALITY_RECORD_SCHEMA;
const PACKAGE_BASE_URL = new URL("./", import.meta.url);
const WEB_BASE_URL = PACKAGE_BASE_URL;

const STRINGS = {
  en: {
    eyebrow: "RESEARCH ANNOTATION", studyLabel: "Study", studyTitle: "xACL-Era · document quality review", loading: "Loading study…", connecting: "Connecting…",
    sampleSet: "SAMPLE SET", papers: "Papers", searchPapers: "Search papers", searchPlaceholder: "Search title or ID",
    period: "Period", allPeriods: "All periods", early: "Early", late: "Late", reviewStatus: "Review status",
    allStatuses: "All status", notStarted: "Not started", draft: "Draft", completed: "Completed",
    annotatorId: "Nickname", annotatorPlaceholder: "Choose a nickname", privateNote: "Quality ratings are stored privately in the project database.",
    loginKicker: "xACL-Era · DOCUMENT QUALITY REVIEW", loginTitle: "Create or resume your annotation profile",
    loginDescription: "Choose a pseudonymous nickname. A private recovery code lets you resume on another device.",
    loginIdHint: "Use a nickname, not your real name or email.",
    loginPrivacy: "Your nickname identifies your private quality record. The recovery code is not stored in the rating record.",
    createProfileMode: "Create profile", restoreProfileMode: "Restore on another device", createProfileButton: "Create profile", restoreProfileButton: "Restore profile",
    recoveryCodeLabel: "Personal recovery code", recoveryCodePlaceholder: "Paste your recovery code", recoveryCodeHint: "Enter the 64-character code saved when your profile was created.",
    recoveryCodeTitle: "Save your recovery code", recoveryCodeIntro: "This code is shown once. Save it somewhere private before continuing; it is needed to restore your profile on another device.",
    recoveryNicknameLabel: "Nickname", downloadRecoveryCode: "Download recovery code", recoveryCodeAck: "I saved this code somewhere private.", continueToStudy: "Continue to the study",
    currentProfileTitle: "A profile is already available on this device", currentProfileLabel: "Continue as", currentProfileHint: "Continue uses this device session. You need your recovery code to restore the profile elsewhere; it cannot be shown again.", currentProfileUnknown: "Current profile", continueProfile: "Continue on this device", useAnotherProfile: "Use another profile",
    preparingStudy: "Checking the study package and private annotation service…",
    readyToCreate: "Choose a nickname to create a profile.", readyToRestore: "Enter your nickname and recovery code to restore your profile.", currentProfileReady: "Your profile is ready on this device. Continue or switch profiles.",
    setupFailed: "The study could not be prepared. Retry setup or contact the study coordinator.", retrySetup: "Retry loading study",
    staticHashMismatch: "A frozen study file failed its integrity check. Scoring is locked until the package is restored.",
    backendNotReady: "The private annotation service is not ready yet. Retry in a moment.",
    serviceUnavailable: "The private annotation service could not be reached. Check your connection and retry.",
    guidanceLoadFailed: "The required document-quality guidance is missing or could not be loaded. Scoring remains locked until the package is repaired.",
    guidanceInvalid: "The document-quality guidance is incomplete or has an unsupported format. Scoring remains locked until the package is repaired.",
    guidanceRevisionLabel: "Guidance revision", recordInvalid: "The saved quality record does not match this protocol. Scoring is locked; contact the study coordinator.",
    annotatorRequired: "Enter a nickname.", invalidAnnotator: "Use 1–64 letters, numbers, underscores or hyphens. Do not use personal information.", recoveryCodeRequired: "Enter your recovery code.", invalidCredentials: "The nickname or recovery code was not accepted. Check both and try again.", nameTaken: "That nickname is already in use. Choose another one.", profileExists: "This device is already linked to a different profile. Continue with it, or use another profile before restoring.", registrationFailed: "Could not create the profile. Retry; the same recovery code will be reused for this attempt.", restoreFailed: "Could not restore this profile. Check the nickname and recovery code, then retry.", currentProfileFailed: "Could not load the profile on this device. Retry or restore with its recovery code.", switchAnnotator: "Switch profile",
    anonymousAuthUnavailable: "Private sign-in is not enabled for this study yet. Contact the study coordinator.",
    switchingSave: "Saving your ratings before switching…", switchSaveFailed: "Could not safely switch because your changes are not saved. Your work remains open here; download a private recovery JSON if needed.",
    allComplete: "All {count} papers are complete. The last paper is open for review.", loadingSession: "Loading quality record…",
    currentPaper: "CURRENT PAPER", saveNow: "Save now",
    previousPaper: "← Previous", nextPaper: "Next →", paperNavigation: "Paper navigation", compareLabel: "REVIEW THE COMPILED PAPER", pdfComparison: "PDF viewers",
    targetOnlyScore: "Rate the compiled PDF. The official PDF is an optional reference.", expandViewers: "Expand viewers", returnToAnnotation: "Return to ratings", syncPageTurns: "Sync page turns",
    targetPdf: "QUALITY TARGET", compiledArxiv: "Compiled arXiv PDF", referencePdf: "OPTIONAL REFERENCE", officialConference: "Official conference PDF (optional)",
    openNewTab: "Open in new tab", page: "Page", fit: "Fit", pdfWait: "PDF will appear when you select a paper.", firstPageReached: "First page reached", lastPageReached: "Last page reached",
    pageCountPending: "Page count pending", rubricLabel: "DOCUMENT-QUALITY RUBRIC", annotationTitle: "Document-quality ratings",
    scoreFor: "Rate", scoreScale: "Score definitions", na: "N/A", uncertain: "Uncertain",
    naHelp: "Use N/A only when the compiled main paper has no applicable figures, tables, or equations.",
    overallDirect: "Judge overall quality directly; do not average the other dimensions.", visualTargetOnly: "Rate this compiled PDF itself.",
    versionDifferencesTitle: "Version differences (optional)", versionDifferencesHelp: "Record observed differences between versions if assessed. They do not affect quality scores or completion; leave blank if not assessed.",
    versionNotesTitle: "Version notes", versionNotesPlaceholder: "Add context for the optional version observations.", versionNotesHelp: "Leave blank if version differences were not assessed.",
    optional: "Optional",
    fullScopeTitle: "I reviewed the full compiled main paper",
    fullScopeHelp: "Review the available main-paper content in the compiled PDF, including relevant technical objects. The official PDF is optional and is not required for quality ratings.",
    markComplete: "Mark paper complete", reopenPaper: "Reopen paper", footerNotice: "Quality ratings apply to the compiled PDF. The official conference PDF is an optional reference.",
    protocolBanner: "New document-quality protocol. Previous alignment ratings are preserved separately. Please rate each paper anew.",
    noPapersMatch: "No papers match these filters.", noTitle: "Untitled paper", noSession: "Load your annotator session to begin.",
    sessionLoaded: "Quality session loaded.", sessionLoadFailed: "Could not load the quality record. Retry or restore with your recovery code.", manifestFailed: "Could not load the frozen paper manifest or quality rubric.",
    rubricMissing: "The document-quality rubric is missing or incomplete. Scoring is locked until the study package is repaired.",
    noActivePaper: "Select a paper from the list to begin.", saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", saveFailed: "Save failed — recovery copy available",
    sessionNotLoaded: "Create or restore a profile to begin.", conflict: "Save conflict — this record changed elsewhere. Download the private recovery JSON before resolving.",
    savedAt: "Saved", saveOffline: "The private service could not be reached. Your latest edits are held in this browser; download a private recovery JSON.",
    downloadRecovery: "Download private recovery JSON", localRecovery: "A local unsaved recovery copy exists.", restoreRecovery: "Restore local copy", noSavedWork: "No saved work yet", noChanges: "No changes to save.",
    localConflict: "The server record is newer than this local copy. The local copy was not applied; download it to compare.",
    recordRecoveryRejected: "The local recovery copy does not match the document-quality protocol and was not applied.", recoveryRestored: "Local document-quality recovery copy restored.",
    completed: "Completed", noFullScope: "Confirm that you reviewed the full compiled main paper.", missingScores: "Rate all six dimensions before completing this paper.",
    invalidAnnotation: "This paper contains a rating that is not valid for the current protocol. Review the ratings before saving.",
    completedSaved: "Paper marked complete and saved.", draftSaved: "Paper returned to draft.",
    pageLabelTarget: "Compiled PDF page", pageLabelOfficial: "Optional reference PDF page", canvasTarget: "Rendered compiled PDF page", canvasOfficial: "Rendered official PDF page",
    previousTarget: "Previous compiled page", nextTarget: "Next compiled page", previousReference: "Previous reference page", nextReference: "Next reference page", of: "of",
    fileNotFound: "This PDF path is missing or invalid in the manifest.", pdfLibFailed: "The local PDF viewer could not be loaded. Check that the packaged PDF.js files are present.",
    renderFailed: "The browser viewer could not render this PDF. Open it separately or in your usual PDF reader before judging the compiled document. Use Uncertain only if evaluation remains blocked.",
    pageUnavailable: "The browser viewer could not render this page. Check the PDF separately before judging visual quality.",
    renderingPage: "Rendering page…", noStatus: "Not started", statusDraft: "Draft", statusCompleted: "Complete", genericError: "Something went wrong.",
  },
  zh: {
    eyebrow: "研究标注", studyLabel: "研究项目", studyTitle: "xACL-Era · 文档质量复核", loading: "正在加载项目…", connecting: "正在连接…",
    sampleSet: "论文样本", papers: "论文", searchPapers: "搜索论文", searchPlaceholder: "按标题或 ID 搜索",
    period: "时期", allPeriods: "全部时期", early: "早期", late: "晚期", reviewStatus: "标注状态",
    allStatuses: "所有状态", notStarted: "未开始", draft: "草稿", completed: "已完成",
    annotatorId: "昵称", annotatorPlaceholder: "选择昵称", privateNote: "质量评分会私密地保存在项目数据库中。",
    loginKicker: "xACL-Era · 文档质量复核", loginTitle: "创建或继续你的标注档案",
    loginDescription: "选择一个匿名昵称。跨设备恢复档案需要专属恢复码。",
    loginIdHint: "请使用昵称，不要填写真实姓名或电子邮箱。",
    loginPrivacy: "昵称用于标识你的私密质量记录。恢复码不会写入评分记录。",
    createProfileMode: "创建档案", restoreProfileMode: "在另一设备恢复", createProfileButton: "创建档案", restoreProfileButton: "恢复档案",
    recoveryCodeLabel: "个人恢复码", recoveryCodePlaceholder: "粘贴恢复码", recoveryCodeHint: "输入创建档案时保存的64位恢复码。",
    recoveryCodeTitle: "保存你的恢复码", recoveryCodeIntro: "恢复码只显示一次。继续前请将它保存在安全的私密位置；在另一台设备恢复档案需要此码。",
    recoveryNicknameLabel: "昵称", downloadRecoveryCode: "下载恢复码", recoveryCodeAck: "我已将恢复码保存在安全的私密位置。", continueToStudy: "进入研究标注",
    currentProfileTitle: "此设备上已有一个档案", currentProfileLabel: "继续使用", currentProfileHint: "继续使用此设备上的登录状态即可恢复。若要在其他设备恢复，必须使用恢复码；此码不会再次显示。", currentProfileUnknown: "当前档案", continueProfile: "在此设备继续", useAnotherProfile: "使用其他档案",
    preparingStudy: "正在检查研究文件和私密标注服务…",
    readyToCreate: "选择昵称以创建档案。", readyToRestore: "输入昵称和恢复码以恢复档案。", currentProfileReady: "此设备上的档案已就绪。你可以继续或切换档案。",
    setupFailed: "研究环境未能准备完成。请重试，或联系研究协调人。", retrySetup: "重试加载研究",
    staticHashMismatch: "固定研究文件未通过完整性检查。恢复文件前，评分功能已锁定。",
    backendNotReady: "私密标注服务尚未就绪，请稍后重试。", serviceUnavailable: "无法连接私密标注服务。请检查网络连接后重试。",
    guidanceLoadFailed: "缺少必需的文档质量说明，或无法加载。请先修复随包文件，再开放评分。",
    guidanceInvalid: "必需的文档质量说明不完整或格式不受支持。请先修复随包文件，再开放评分。",
    guidanceRevisionLabel: "说明版本", recordInvalid: "已保存的质量记录与当前协议不符。评分已锁定，请联系研究协调人。",
    annotatorRequired: "请输入昵称。", invalidAnnotator: "昵称需为1–64位字母、数字、下划线或连字符。请勿使用个人信息。",
    recoveryCodeRequired: "请输入恢复码。", invalidCredentials: "昵称或恢复码不正确，请检查后重试。", nameTaken: "该昵称已被使用，请选择其他昵称。",
    profileExists: "此设备已关联到其他档案。请继续使用此档案，或先切换档案后再恢复。",
    registrationFailed: "无法创建档案。请重试；本次尝试会继续使用同一个恢复码。", restoreFailed: "无法恢复该档案。请检查昵称和恢复码后重试。",
    currentProfileFailed: "无法加载此设备上的档案。请重试，或使用恢复码恢复。", switchAnnotator: "切换档案",
    anonymousAuthUnavailable: "此研究尚未启用私密登录，请联系研究协调人。",
    switchingSave: "正在保存评分，然后切换…", switchSaveFailed: "修改尚未保存，无法安全切换。当前评分仍保持打开；如有需要，请下载私密恢复 JSON。",
    allComplete: "已完成全部 {count} 篇论文。最后一篇已打开供复核。", loadingSession: "正在加载质量记录…",
    currentPaper: "当前论文", saveNow: "立即保存",
    previousPaper: "← 上一篇", nextPaper: "下一篇 →", paperNavigation: "论文导航", compareLabel: "检查编译版论文", pdfComparison: "PDF 查看器",
    targetOnlyScore: "评价编译版 PDF。官方 PDF 仅作可选参考。", expandViewers: "展开 PDF 查看器", returnToAnnotation: "返回评分", syncPageTurns: "同步翻页",
    targetPdf: "质量评分对象", compiledArxiv: "arXiv 编译 PDF", referencePdf: "可选参照", officialConference: "会议官方 PDF（可选）",
    openNewTab: "在新标签页打开", page: "页", fit: "适应窗口", pdfWait: "选择论文后将在此显示 PDF。", firstPageReached: "已到第一页", lastPageReached: "已到最后一页",
    pageCountPending: "等待读取页数", rubricLabel: "文档质量评分标准", annotationTitle: "文档质量评分",
    scoreFor: "评分", scoreScale: "分数定义", na: "N/A", uncertain: "无法判断", naHelp: "仅当编译版正文中没有适用的图、表或公式时选择 N/A。",
    overallDirect: "直接判断总体质量，不要计算其他分项的平均值。", visualTargetOnly: "评价此编译版 PDF 本身。",
    versionDifferencesTitle: "版本差异（选填）", versionDifferencesHelp: "如已检查，可记录观察到的版本差异。它们不影响质量评分或完成状态；未检查时留空。",
    versionNotesTitle: "版本说明", versionNotesPlaceholder: "可补充版本观察的背景信息。", versionNotesHelp: "未检查版本差异时请留空。",
    optional: "选填",
    fullScopeTitle: "我已检查编译版正文全文", fullScopeHelp: "检查编译版中可用的正文内容及相关技术对象。官方 PDF 为可选参照，不是质量评分的必需内容。",
    markComplete: "将论文标记为完成", reopenPaper: "重新打开论文", footerNotice: "质量评分针对编译版 PDF。会议官方 PDF 仅作可选参考。",
    protocolBanner: "新的文档质量协议。此前的版本对齐评分已单独保留。请为每篇论文重新评分。",
    noPapersMatch: "没有符合筛选条件的论文。", noTitle: "无标题论文", noSession: "加载标注者会话后即可开始。",
    sessionLoaded: "质量标注会话已加载。", sessionLoadFailed: "无法加载质量记录。请检查昵称和恢复码，或稍后重试。", manifestFailed: "无法加载冻结的论文清单或质量评分标准。",
    rubricMissing: "文档质量评分标准缺失或不完整。修复研究包后才能评分。",
    noActivePaper: "从列表中选择一篇论文开始。", saved: "已保存", saving: "保存中…", unsaved: "有未保存修改", saveFailed: "保存失败，可下载恢复副本",
    sessionNotLoaded: "创建或恢复档案后即可开始。", conflict: "保存冲突：此记录已在其他位置更新。请先下载私密恢复 JSON。",
    savedAt: "已保存", saveOffline: "无法连接私密标注服务。最新修改暂存在此浏览器中，请下载私密恢复 JSON。",
    downloadRecovery: "下载私密恢复 JSON", localRecovery: "检测到本地未保存的恢复副本。", restoreRecovery: "恢复本地副本", noSavedWork: "尚无已保存评分", noChanges: "没有需要保存的修改。",
    localConflict: "服务器记录版本高于本地副本。未应用本地副本；可下载后进行比较。",
    recordRecoveryRejected: "本地恢复副本与文档质量协议不符，未应用。", recoveryRestored: "本地文档质量恢复副本已恢复。",
    completed: "已完成", noFullScope: "请确认已检查编译版正文全文。", missingScores: "完成前请评价全部六个维度。",
    invalidAnnotation: "此论文包含不符合当前协议的评分。请检查评分后再保存。",
    completedSaved: "论文已标记为完成并保存。", draftSaved: "论文已恢复为草稿。",
    pageLabelTarget: "编译版 PDF 页码", pageLabelOfficial: "可选参照 PDF 页码", canvasTarget: "编译版 PDF 页面", canvasOfficial: "官方 PDF 页面",
    previousTarget: "编译版 PDF 上一页", nextTarget: "编译版 PDF 下一页", previousReference: "参照 PDF 上一页", nextReference: "参照 PDF 下一页", of: "/",
    fileNotFound: "清单中缺少此 PDF 路径或路径无效。", pdfLibFailed: "无法加载本地 PDF 查看器。请检查随包提供的 PDF.js 文件。",
    renderFailed: "浏览器内查看器无法渲染此 PDF。请单独打开 PDF 或用常用阅读器检查后再评价编译文档；若仍无法评价，可选择“无法判断”。",
    pageUnavailable: "浏览器内查看器无法显示此页。请单独检查 PDF 后再评价文档质量。",
    renderingPage: "正在渲染页面…", noStatus: "未开始", statusDraft: "草稿", statusCompleted: "完成", genericError: "发生错误。",
  },
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

const state = {
  language: "en",
  config: null, hosted: null, guidanceHash: null,
  manifest: null, manifestHash: null, rubric: null, guidance: null, papers: [],
  record: null, annotatorId: "", activeSampleId: null, activeIndex: -1,
  authMode: "create", currentProfileId: "", currentProfileRecord: null,
  profileSessionUnknown: false, pendingRegistration: null, recoveryReveal: null,
  initialized: false, initializing: false, eventsBound: false, startupErrorKey: "", startupErrorDetail: "",
  loginErrorKey: "", sessionErrorKey: "", sessionErrorDetail: "",
  sessionLoading: false, switching: false, sessionReady: false, rubricReady: false, guidanceReady: false, dirty: false, dirtyVersion: 0,
  savingPromise: null, saveTimer: null, saveBlocked: false, saveError: "", toastTimer: null,
  pdfjsPromise: null, viewers: { compiled: null, official: null }, focusViewers: false, syncPdfNavigation: false,
  localRecovery: null, localRecoveryConflict: false, localRecoveryRejected: false,
};

function t(key) { return STRINGS[state.language]?.[key] ?? STRINGS.en[key] ?? key; }
function localized(value) {
  if (value && typeof value === "object") return String(value[state.language] ?? value.en ?? value.zh ?? "");
  if (typeof value !== "string") return "";
  const split = value.lastIndexOf(" / ");
  if (split < 0) return value;
  return state.language === "zh" ? value.slice(split + 3) : value.slice(0, split);
}
function packageAssetUrl(relativePath) { return new URL(relativePath, PACKAGE_BASE_URL); }
function webAssetUrl(relativePath) { return new URL(relativePath, WEB_BASE_URL); }
function bilingualText(value) {
  return Boolean(value && typeof value === "object" &&
    typeof value.en === "string" && value.en.trim() &&
    typeof value.zh === "string" && value.zh.trim());
}
function guidanceIsComplete(guidance) {
  return guidance?.schema === "xacl.document-quality-guidance.v1" &&
    guidance.protocol_id === QUALITY_PROTOCOL_ID &&
    typeof guidance.version === "string" && guidance.version.trim() &&
    bilingualText(guidance.title) && bilingualText(guidance.scope) &&
    Array.isArray(guidance.quick_rules) && guidance.quick_rules.length >= 1 && guidance.quick_rules.length <= 4 &&
    guidance.quick_rules.every(bilingualText) &&
    bilingualText(guidance.publication_notice?.title) && bilingualText(guidance.publication_notice?.text) &&
    bilingualText(guidance.details_title) && Array.isArray(guidance.details) &&
    guidance.details.length >= 1 && guidance.details.length <= 8 &&
    guidance.details.every((item) => bilingualText(item?.title) && bilingualText(item?.text));
}
function setLanguage(language) {
  const guidanceWasOpen = Boolean($("#guidance-details")?.open);
  state.language = language === "zh" ? "zh" : "en";
  document.documentElement.lang = state.language;
  $$('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  $$('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  $$('[data-i18n-title]').forEach((node) => { node.title = t(node.dataset.i18nTitle); node.setAttribute("aria-label", t(node.dataset.i18nTitle)); });
  $$('.language-button').forEach((button) => {
    const active = button.dataset.language === state.language;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  updateStaticAria();
  renderBoundaryStatuses();
  renderViewerFocusLayout();
  if (state.manifest) {
    renderPaperList();
    renderRubric();
    if (guidanceWasOpen) $("#guidance-details").open = true;
    renderActivePaper();
    renderProgress();
  }
  renderDynamicLabels();
  renderLoginState();
  renderSessionControls();
  renderSaveStatus();
}
function updateStaticAria() {
  const labels = {
    compiled: ["previousTarget", "nextTarget", "pageLabelTarget", "compiledArxiv"],
    official: ["previousReference", "nextReference", "pageLabelOfficial", "officialConference"],
  };
  for (const [id, keys] of Object.entries(labels)) {
    const [previous, next, page, stage] = keys;
    const prev = $(`[data-viewer-action="prev"][data-viewer="${id}"]`);
    const nxt = $(`[data-viewer-action="next"][data-viewer="${id}"]`);
    const pageInput = $(`[data-page-input="${id}"]`);
    const stageNode = $(`[data-stage="${id}"]`);
    const canvas = $(`[data-canvas="${id}"]`);
    if (prev) prev.setAttribute("aria-label", t(previous));
    if (nxt) nxt.setAttribute("aria-label", t(next));
    if (pageInput) pageInput.setAttribute("aria-label", t(page));
    if (stageNode) stageNode.setAttribute("aria-label", t(stage));
    if (canvas) canvas.setAttribute("aria-label", t(id === "compiled" ? "canvasTarget" : "canvasOfficial"));
  }
}

function nowIso() { return new Date().toISOString(); }
function validAnnotatorId(value) { return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value); }
function stableLocalKey() {
  return `xacl.${QUALITY_PROTOCOL_ID}.recovery:${encodeURIComponent(state.config?.supabase_url || "")}:${encodeURIComponent(state.config?.study_id || "")}:${state.manifestHash}:${encodeURIComponent(state.annotatorId)}`;
}
function safeFilenamePart(value) { return String(value || "annotation").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "annotation"; }
function setToast(message, kind = "info", duration = 3600) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), duration);
}
function setSaveState(value, message) {
  const box = $("#save-status");
  box.dataset.state = value;
  $("#save-status-text").textContent = message ?? t(value === "saved" ? "saved" : value === "saving" ? "saving" : value === "error" ? "saveFailed" : value === "conflict" ? "conflict" : "unsaved");
}
function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function recordTemplate(annotatorId, revision = 0) {
  const stamp = nowIso();
  return {
    schema: RECORD_SCHEMA, protocol_id: QUALITY_PROTOCOL_ID, dataset_id: state.manifest.dataset_id,
    manifest_sha256: state.manifestHash, rubric_version: state.rubric.version,
    annotator_id: annotatorId, revision, created_at: stamp, updated_at: stamp, annotations: {},
  };
}
function blankAnnotation() {
  return blankQualityAnnotation(nowIso());
}
function ensureAnnotation(sampleId) {
  if (!state.record.annotations[sampleId]) state.record.annotations[sampleId] = blankAnnotation();
  return state.record.annotations[sampleId];
}
function activePaper() { return state.papers.find((paper) => paper.sample_id === state.activeSampleId) || null; }
function activeAnnotation() { return state.record && state.activeSampleId ? ensureAnnotation(state.activeSampleId) : null; }

function hostedStartupErrorKey(error) {
  return ({
    static_hash_mismatch: "staticHashMismatch",
    backend_not_ready: "backendNotReady",
    service_unavailable: "serviceUnavailable",
    guidance_invalid: "guidanceInvalid",
    guidance_unavailable: "guidanceLoadFailed",
    guidance_hash_mismatch: "staticHashMismatch",
    manifest_invalid: "manifestFailed",
    manifest_unavailable: "manifestFailed",
    rubric_invalid: "rubricMissing",
    rubric_unavailable: "rubricMissing",
    config_invalid: "manifestFailed",
    config_unavailable: "manifestFailed",
    static_package_invalid: "manifestFailed",
    static_package_unavailable: "manifestFailed",
    crypto_unavailable: "manifestFailed",
    anonymous_auth_unavailable: "anonymousAuthUnavailable",
    quality_record_invalid: "recordInvalid",
  })[error?.code] || "setupFailed";
}

async function initialize() {
  if (state.initialized || state.initializing) return;
  state.initializing = true;
  state.startupErrorKey = "";
  state.startupErrorDetail = "";
  state.currentProfileId = "";
  state.currentProfileRecord = null;
  state.profileSessionUnknown = false;
  bindEvents();
  renderDynamicLabels();
  renderLoginState();
  try {
    const assets = await loadHostedAssets();
    const hosted = createHostedAdapter(assets.config, {
      supabaseLibrary: globalThis.supabase,
      rubricVersion: assets.rubric.version,
      guidanceVersion: assets.guidance.version,
      guidanceSha256: assets.guidanceHash,
    });
    const health = await hosted.health();
    assertHostedHealth(health, assets);
    state.config = assets.config;
    state.hosted = hosted;
    state.manifest = assets.manifest;
    state.manifestHash = assets.manifestHash;
    state.rubric = assets.rubric;
    state.guidance = assets.guidance;
    state.guidanceHash = assets.guidanceHash;
    state.guidanceReady = guidanceIsComplete(state.guidance);
    state.papers = assets.manifest.papers;
    state.rubricReady = rubricIsComplete(state.rubric);
    state.startupErrorKey = "";
    state.startupErrorDetail = "";
    $("#dataset-title").textContent = t("studyTitle");
    $("#paper-total").textContent = String(state.papers.length);
    renderPaperList();
    renderRubric();
    renderProgress();
    const existingSession = await hosted.getSession();
    if (existingSession) {
      const currentRecord = await hosted.currentAnnotations();
      if (currentRecord) {
        if (!isMatchingRecord(currentRecord, currentRecord.annotator_id)) {
          throw Object.assign(new Error(), { code: "quality_record_invalid" });
        }
        state.currentProfileId = currentRecord.annotator_id;
        state.currentProfileRecord = normalizeRecord(currentRecord, currentRecord.annotator_id);
        state.profileSessionUnknown = false;
        $("#annotator-id").value = currentRecord.annotator_id;
      }
    }
    $("#active-paper-title").textContent = t("noActivePaper");
    $("#active-paper-subtitle").textContent = t("noSession");
    if (!state.rubricReady) showRubricMissing();
    state.initialized = true;
    renderLoginState();
    renderSessionControls();
    renderSaveStatus();
  } catch (error) {
    state.initialized = false;
    state.startupErrorKey = hostedStartupErrorKey(error);
    state.startupErrorDetail = "";
    renderDynamicLabels();
  } finally {
    state.initializing = false;
    renderLoginState();
    renderSessionControls();
    renderSaveStatus();
  }
}
function rubricIsComplete(rubric) {
  if (!rubric || rubric.schema !== "xacl.document-quality-rubric.v1" || rubric.protocol_id !== QUALITY_PROTOCOL_ID ||
      rubric.version !== "document-quality-rubric-v1" || !bilingualText(rubric.title) || !bilingualText(rubric.scope) ||
      !Array.isArray(rubric.dimensions) || rubric.dimensions.length !== SCORE_KEYS.length ||
      !Array.isArray(rubric.version_difference_flags) || rubric.version_difference_flags.length !== FLAG_KEYS.length) return false;
  const dimensions = new Map(rubric.dimensions.map((item) => [item.key, item]));
  const dimensionsReady = SCORE_KEYS.every((key) => {
    const item = dimensions.get(key);
    return item && typeof item.label === "string" && item.label.trim() && bilingualText(item.description) &&
      typeof item.allows_na === "boolean" && item.allows_na === (key === "technical_presentation") &&
      item.scale && [1, 2, 3, 4, 5].every((score) => bilingualText(item.scale[String(score)]));
  });
  const differenceKeys = rubric.version_difference_flags.map((item) => item?.key);
  return dimensionsReady && new Set(differenceKeys).size === FLAG_KEYS.length &&
    FLAG_KEYS.every((key) => differenceKeys.includes(key)) && rubric.dimensions.every((item) => SCORE_KEYS.includes(item.key));
}
function showRubricMissing() {
  $("#guidance-scope").textContent = t("rubricMissing");
  $("#rubric-scoring").replaceChildren();
  $("#version-difference-list").replaceChildren();
  renderLoginState();
  renderSessionControls();
  renderSaveStatus();
}

function bindEvents() {
  if (state.eventsBound) return;
  state.eventsBound = true;
  $$('.language-button').forEach((button) => button.addEventListener("click", () => setLanguage(button.dataset.language)));
  $("#paper-search").addEventListener("input", renderPaperList);
  $("#period-filter").addEventListener("change", renderPaperList);
  $("#status-filter").addEventListener("change", renderPaperList);
  $("#annotator-login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitProfileForm();
  });
  $("#annotator-id").addEventListener("input", () => {
    if (state.loginErrorKey || state.sessionErrorKey) {
      state.loginErrorKey = "";
      state.sessionErrorKey = "";
      state.sessionErrorDetail = "";
      renderLoginState();
    }
  });
  $("#annotator-code").addEventListener("input", () => {
    if (state.loginErrorKey || state.sessionErrorKey) {
      state.loginErrorKey = "";
      state.sessionErrorKey = "";
      state.sessionErrorDetail = "";
      renderLoginState();
    }
  });
  $("#mode-create-profile").addEventListener("click", () => setAuthMode("create"));
  $("#mode-restore-profile").addEventListener("click", () => setAuthMode("restore"));
  $("#continue-profile").addEventListener("click", continueCurrentProfile);
  $("#use-another-profile").addEventListener("click", switchLoginProfile);
  $("#recovery-code-saved").addEventListener("change", renderLoginState);
  $("#download-recovery-code").addEventListener("click", downloadRecoveryCode);
  $("#continue-after-recovery").addEventListener("click", continueAfterRecoveryCode);
  $("#retry-startup").addEventListener("click", initialize);
  $("#switch-annotator").addEventListener("click", switchAnnotator);
  $("#previous-paper").addEventListener("click", () => movePaper(-1));
  $("#next-paper").addEventListener("click", () => movePaper(1));
  $("#save-button").addEventListener("click", () => flushSave(true));
  $("#complete-review").addEventListener("click", toggleComplete);
  $("#version-notes").addEventListener("input", updateVersionNotes);
  $("#reviewed-full-scope").addEventListener("change", () => mutateActive((row) => { row.reviewed_full_scope = $("#reviewed-full-scope").checked; }));
  $("#focus-viewers").addEventListener("click", toggleViewerFocus);
  $("#sync-pdf-pages").addEventListener("change", (event) => setPdfSyncNavigation(event.currentTarget.checked));
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("change", onDocumentChange);
  window.addEventListener("resize", onWindowResize, { passive: true });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.focusViewers) toggleViewerFocus(); });
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty && !state.savingPromise && !state.pendingRegistration && !state.recoveryReveal) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
function onDocumentClick(event) {
  const paperButton = event.target.closest("[data-sample-id]");
  if (paperButton) { selectPaper(paperButton.dataset.sampleId); return; }
  const scoreButton = event.target.closest("[data-score-key]");
  if (scoreButton) { setScore(scoreButton.dataset.scoreKey, scoreButton.dataset.option); return; }
  const viewerAction = event.target.closest("[data-viewer-action]");
  if (viewerAction) handleViewerAction(viewerAction.dataset.viewer, viewerAction.dataset.viewerAction);
  const restore = event.target.closest("[data-recover-local]");
  if (restore) restoreLocalRecovery();
  const download = event.target.closest("[data-download-recovery]");
  if (download) downloadRecovery();
  const exitFocus = event.target.closest("[data-exit-focus]");
  if (exitFocus) toggleViewerFocus();
}
function onDocumentChange(event) {
  const flagInput = event.target.closest("[data-version-difference-key]");
  if (flagInput) updateVersionDifference(flagInput.dataset.versionDifferenceKey, flagInput.checked);
  const pageInput = event.target.closest("[data-page-input]");
  if (pageInput) {
    clearBoundaryStatuses();
    goToPage(pageInput.dataset.pageInput, Number(pageInput.value));
  }
}

function setAuthMode(mode) {
  if (!['create', 'restore'].includes(mode) || state.sessionLoading || state.switching ||
      state.pendingRegistration || state.currentProfileRecord || state.recoveryReveal) return;
  state.authMode = mode;
  state.loginErrorKey = "";
  state.sessionErrorKey = "";
  state.sessionErrorDetail = "";
  $("#annotator-code").value = "";
  renderLoginState();
}

async function ensureAnonymousSession() {
  if (!state.hosted) throw Object.assign(new Error(), { code: "service_unavailable" });
  if (!await state.hosted.getSession()) await state.hosted.signInAnonymously();
}

function validateNicknameAndStudy() {
  const requested = $("#annotator-id").value.trim();
  if (!requested) {
    state.loginErrorKey = "annotatorRequired";
    renderLoginState();
    $("#annotator-id").focus();
    return null;
  }
  if (!validAnnotatorId(requested)) {
    state.loginErrorKey = "invalidAnnotator";
    renderLoginState();
    $("#annotator-id").focus();
    return null;
  }
  if (!state.initialized || !state.rubricReady || !state.guidanceReady || state.startupErrorKey) {
    state.loginErrorKey = !state.rubricReady ? "rubricMissing" : !state.guidanceReady ? "guidanceInvalid" : "setupFailed";
    renderLoginState();
    return null;
  }
  return requested;
}

async function submitProfileForm() {
  if (state.sessionLoading || state.switching || state.sessionReady || state.recoveryReveal) return;
  state.loginErrorKey = "";
  state.sessionErrorKey = "";
  state.sessionErrorDetail = "";
  const requested = validateNicknameAndStudy();
  if (!requested) return;

  if (state.pendingRegistration && state.pendingRegistration.annotatorId !== requested) {
    state.loginErrorKey = "registrationFailed";
    renderLoginState();
    return;
  }
  let recoveryCode = "";
  if (state.authMode === "restore") {
    recoveryCode = $("#annotator-code").value.trim();
    if (!recoveryCode) {
      state.loginErrorKey = "recoveryCodeRequired";
      renderLoginState();
      $("#annotator-code").focus();
      return;
    }
    if (!/^[0-9a-f]{64}$/.test(recoveryCode)) {
      state.loginErrorKey = "invalidCredentials";
      renderLoginState();
      $("#annotator-code").focus();
      return;
    }
  }

  state.sessionLoading = true;
  renderLoginState();
  try {
    await ensureAnonymousSession();
    if (state.authMode === "create") {
      recoveryCode = state.pendingRegistration?.recoveryCode || randomRecoveryCode();
      state.pendingRegistration ||= { annotatorId: requested, recoveryCode };
      const record = await state.hosted.register(requested, recoveryCode);
      if (!isMatchingRecord(record, requested)) throw Object.assign(new Error(), { code: "service_unavailable" });
      state.currentProfileId = requested;
      state.currentProfileRecord = normalizeRecord(record, requested);
      state.profileSessionUnknown = false;
      state.recoveryReveal = { annotatorId: requested, recoveryCode, record: state.currentProfileRecord };
      $("#recovery-code-nickname").textContent = requested;
      $("#recovery-code-display").textContent = recoveryCode;
      $("#recovery-code-saved").checked = false;
      $("#annotator-code").value = "";
      state.loginErrorKey = "";
      state.sessionErrorKey = "";
    } else {
      const record = await state.hosted.resume(requested, recoveryCode);
      if (!isMatchingRecord(record, requested)) throw Object.assign(new Error(), { code: "service_unavailable" });
      $("#annotator-code").value = "";
      state.currentProfileId = requested;
      state.currentProfileRecord = normalizeRecord(record, requested);
      state.profileSessionUnknown = false;
      state.pendingRegistration = null;
      enterAnnotationSession(record, requested);
    }
  } catch (error) {
    $("#annotator-code").value = "";
    if (error?.code === "name_taken") {
      state.pendingRegistration = null;
      state.loginErrorKey = "nameTaken";
    } else if (error?.code === "profile_exists") {
      state.pendingRegistration = null;
      state.profileSessionUnknown = true;
      try {
        const current = await state.hosted.currentAnnotations();
        if (current && isMatchingRecord(current, current.annotator_id)) {
          state.currentProfileId = current.annotator_id;
          state.currentProfileRecord = normalizeRecord(current, current.annotator_id);
          state.profileSessionUnknown = false;
          $("#annotator-id").value = current.annotator_id;
        }
      } catch { /* Preserve the safe, generic profile-exists message. */ }
      state.loginErrorKey = "profileExists";
    } else if (state.authMode === "create") {
      state.loginErrorKey = error?.code === "anonymous_auth_unavailable" ? "anonymousAuthUnavailable" :
        error?.code === "crypto_unavailable" ? "setupFailed" : "registrationFailed";
    } else {
      state.loginErrorKey = error?.code === "invalid_credentials" ? "invalidCredentials" :
        error?.code === "anonymous_auth_unavailable" ? "anonymousAuthUnavailable" : "restoreFailed";
    }
  } finally {
    state.sessionLoading = false;
    renderLoginState();
    renderSessionControls();
    renderSaveStatus();
  }
}

async function continueCurrentProfile() {
  if (state.sessionLoading || state.switching || state.sessionReady || !state.currentProfileId) return;
  state.sessionLoading = true;
  state.loginErrorKey = "";
  state.sessionErrorKey = "";
  renderLoginState();
  try {
    const record = await state.hosted.currentAnnotations();
    if (!record || !isMatchingRecord(record, state.currentProfileId)) throw Object.assign(new Error(), { code: "invalid_credentials" });
    state.currentProfileRecord = normalizeRecord(record, state.currentProfileId);
    enterAnnotationSession(record, state.currentProfileId);
  } catch {
    state.loginErrorKey = "currentProfileFailed";
  } finally {
    state.sessionLoading = false;
    renderLoginState();
    renderSessionControls();
    renderSaveStatus();
  }
}

function enterAnnotationSession(record, annotatorId) {
  state.annotatorId = annotatorId;
  state.record = normalizeRecord(record, annotatorId);
  state.currentProfileId = annotatorId;
  state.currentProfileRecord = normalizeRecord(record, annotatorId);
  state.profileSessionUnknown = false;
  state.sessionReady = true;
  state.dirty = false;
  state.dirtyVersion = 0;
  state.saveBlocked = false;
  state.saveError = "";
  state.activeSampleId = null;
  state.activeIndex = -1;
  state.localRecovery = null;
  state.localRecoveryConflict = false;
  $("#period-filter").value = "all";
  $("#status-filter").value = "all";
  $("#paper-search").value = "";
  $("#session-annotator").textContent = annotatorId;
  $("#session-annotator").title = annotatorId;
  $("#last-saved").textContent = state.record.revision > 0 ? `${t("savedAt")}: ${formatDate(state.record.updated_at)}` : "—";
  offerLocalRecovery();
  renderLoginState();
  renderPaperList();
  renderProgress();
  selectResumePaper();
  renderSessionControls();
  renderSaveStatus();
  setToast(t("sessionLoaded"), "success");
}

function continueAfterRecoveryCode() {
  const reveal = state.recoveryReveal;
  if (!reveal || !$("#recovery-code-saved").checked || state.sessionLoading) return;
  state.pendingRegistration = null;
  state.recoveryReveal = null;
  $("#recovery-code-display").textContent = "";
  $("#recovery-code-saved").checked = false;
  $("#annotator-id").value = "";
  enterAnnotationSession(reveal.record, reveal.annotatorId);
  renderLoginState();
}

function downloadRecoveryCode() {
  if (!state.recoveryReveal) return;
  const { annotatorId, recoveryCode } = state.recoveryReveal;
  const content = [
    "xACL-Era personal recovery code",
    `Nickname: ${annotatorId}`,
    `Recovery code: ${recoveryCode}`,
    "",
    "Keep this file private. The code is needed to restore your annotation profile on another device.",
  ].join("\n");
  downloadBlob(new Blob([content, "\n"], { type: "text/plain;charset=utf-8" }), `xacl-era-${safeFilenamePart(annotatorId)}-recovery.txt`);
}

async function switchLoginProfile() {
  if (state.sessionLoading || state.switching || state.sessionReady || (!state.currentProfileId && !state.profileSessionUnknown)) return;
  state.switching = true;
  let switched = false;
  state.loginErrorKey = "";
  renderLoginState();
  try {
    await state.hosted.signOut();
    state.currentProfileId = "";
    state.currentProfileRecord = null;
    state.profileSessionUnknown = false;
    state.authMode = "create";
    $("#annotator-id").value = "";
    $("#annotator-code").value = "";
    state.sessionErrorKey = "";
    state.loginErrorKey = "";
    renderLoginState();
    switched = true;
  } catch {
    state.loginErrorKey = "serviceUnavailable";
  } finally {
    state.switching = false;
    renderLoginState();
    if (switched) $("#annotator-id").focus({ preventScroll: true });
  }
}

async function switchAnnotator() {
  if (!state.sessionReady || state.switching || state.sessionLoading) return;
  state.switching = true;
  let switched = false;
  renderSessionControls();
  renderSaveStatus();
  try {
    if (state.savingPromise) {
      const inFlightSave = state.savingPromise;
      const saved = await inFlightSave;
      if (!saved || state.saveBlocked) throw new Error("save failed");
    }
    if (state.dirty) {
      const saved = await flushSave(false);
      if (!saved || state.dirty || state.saveBlocked) throw new Error("save failed");
    }
    if (state.dirty || state.saveBlocked || state.savingPromise) throw new Error("save failed");
    await state.hosted.signOut();

    clearTimeout(state.saveTimer);
    state.sessionReady = false;
    state.annotatorId = "";
    state.currentProfileId = "";
    state.currentProfileRecord = null;
    state.profileSessionUnknown = false;
    state.pendingRegistration = null;
    state.recoveryReveal = null;
    state.record = null;
    state.activeSampleId = null;
    state.activeIndex = -1;
    state.dirty = false;
    state.dirtyVersion = 0;
    state.saveBlocked = false;
    state.saveError = "";
    state.loginErrorKey = "";
    state.sessionErrorKey = "";
    state.sessionErrorDetail = "";
    state.localRecovery = null;
    state.localRecoveryConflict = false;
    state.focusViewers = false;
    renderViewerFocusLayout();
    for (const side of ["compiled", "official"]) clearViewer(side, t("pdfWait"));
    const recoveryBanner = $("#recovery-banner");
    if (recoveryBanner) recoveryBanner.remove();
    $("#paper-search").value = "";
    $("#period-filter").value = "all";
    $("#status-filter").value = "all";
    $("#annotator-id").value = "";
    $("#annotator-code").value = "";
    $("#recovery-code-display").textContent = "";
    $("#recovery-code-saved").checked = false;
    $("#session-annotator").textContent = "—";
    $("#session-annotator").title = "";
    $("#last-saved").textContent = "—";
    $("#last-saved").title = "";
    state.authMode = "create";
    renderBlankAnnotation();
    renderPaperList();
    renderProgress();
    renderActivePaper();
    renderLoginState();
    renderSaveStatus();
    window.scrollTo(0, 0);
    switched = true;
  } catch {
    setToast(t("switchSaveFailed"), "error", 7000);
  } finally {
    state.switching = false;
    renderLoginState();
    renderSessionControls();
    renderSaveStatus();
    if (switched) $("#annotator-id").focus({ preventScroll: true });
  }
}
function isMatchingRecord(record, annotatorId) {
  if (!record || !state.manifest || !state.manifestHash || !state.rubric) return false;
  return qualityRecordIssue(record, {
    annotatorId,
    datasetId: state.manifest.dataset_id,
    manifestSha256: state.manifestHash,
    rubricVersion: state.rubric.version,
  }) === null;
}
function normalizeRecord(record, annotatorId) {
  if (!isMatchingRecord(record, annotatorId)) throw Object.assign(new Error(), { code: "quality_record_invalid" });
  return structuredClone(record);
}

function renderPaperList() {
  const list = $("#paper-list");
  if (!list || !state.manifest) return;
  const query = $("#paper-search").value.trim().toLowerCase();
  const period = $("#period-filter").value;
  const status = $("#status-filter").value;
  const filtered = state.papers.filter((paper) => {
    const row = state.record?.annotations?.[paper.sample_id];
    const rowStatus = row?.status || "not_started";
    const searchable = `${paper.title || ""} ${paper.paper_id || ""} ${paper.sample_id || ""} ${paper.area_code || ""} ${paper.area_name || ""}`.toLowerCase();
    return (!query || searchable.includes(query)) && (period === "all" || paper.period === period) && (status === "all" || rowStatus === status);
  });
  const children = filtered.map((paper) => {
    const row = state.record?.annotations?.[paper.sample_id];
    const rowStatus = row?.status || "not_started";
    const isActive = paper.sample_id === state.activeSampleId;
    const button = element("button", `paper-item${isActive ? " is-active" : ""}`);
    button.type = "button";
    button.dataset.sampleId = paper.sample_id;
    button.dataset.status = rowStatus;
    button.setAttribute("aria-current", isActive ? "true" : "false");
    const dot = element("span", "paper-state-dot");
    dot.setAttribute("aria-hidden", "true");
    const copy = element("span", "paper-item-copy");
    copy.append(element("span", "paper-item-title", paper.title || t("noTitle")));
    copy.append(element("span", "paper-item-meta", `${paper.sample_id} · ${paper.paper_id || "—"} · ${periodLabel(paper.period)}`));
    button.append(dot, copy, element("span", "paper-item-badge", statusLabel(rowStatus)));
    return button;
  });
  if (children.length === 0) children.push(element("p", "paper-list-empty", t("noPapersMatch")));
  list.replaceChildren(...children);
  $("#paper-total").textContent = String(state.papers.length);
}
function periodLabel(value) { return value === "early" ? t("early") : value === "late" ? t("late") : String(value || "—"); }
function statusLabel(value) { return value === "completed" ? t("statusCompleted") : value === "draft" ? t("statusDraft") : t("noStatus"); }
function renderProgress() {
  const complete = state.papers.filter((paper) => state.record?.annotations?.[paper.sample_id]?.status === "completed").length;
  const count = state.papers.length;
  $("#completion-count").textContent = `${complete} / ${count}`;
  $("#completion-progress-bar").style.width = `${count ? (complete / count) * 100 : 0}%`;
  const progress = $("#completion-progress");
  progress.setAttribute("aria-valuemax", String(count));
  progress.setAttribute("aria-valuenow", String(complete));
  progress.setAttribute("aria-label", state.language === "zh" ? "已完成论文数" : "Completed papers");
  renderAllCompleteBanner();
}
function allPapersCompleted() {
  return state.papers.length > 0 && state.papers.every((paper) => state.record?.annotations?.[paper.sample_id]?.status === "completed");
}
function renderAllCompleteBanner() {
  const banner = $("#all-complete-banner");
  if (!banner) return;
  const complete = state.sessionReady && allPapersCompleted();
  banner.classList.toggle("is-hidden", !complete);
  if (complete) banner.textContent = t("allComplete").replace("{count}", String(state.papers.length));
}
function resumeSample() {
  const index = state.papers.findIndex((paper) => state.record?.annotations?.[paper.sample_id]?.status !== "completed");
  return index >= 0 ? state.papers[index] : state.papers[state.papers.length - 1] || null;
}
function selectResumePaper() {
  const paper = resumeSample();
  if (paper) selectPaper(paper.sample_id);
}
function selectPaper(sampleId) {
  const index = state.papers.findIndex((paper) => paper.sample_id === sampleId);
  if (index < 0) return;
  if (!state.sessionReady) return;
  clearBoundaryStatuses();
  state.activeIndex = index;
  state.activeSampleId = sampleId;
  ensureAnnotation(sampleId);
  renderPaperList();
  renderActivePaper();
  loadPaperPdfs(activePaper());
}
function movePaper(delta) {
  if (!state.sessionReady || !state.papers.length) return;
  const nextIndex = Math.max(0, Math.min(state.papers.length - 1, state.activeIndex + delta));
  if (nextIndex === state.activeIndex) return;
  const nextPaper = state.papers[nextIndex];
  if (!nextPaper || nextPaper.sample_id === state.activeSampleId) return;
  selectPaper(nextPaper.sample_id);
  $("#active-paper-title").focus({ preventScroll: true });
  $(".paper-heading").scrollIntoView({ block: "start", behavior: "auto" });
}
function renderActivePaper() {
  const paper = activePaper();
  const ready = state.sessionReady && paper;
  $("#previous-paper").disabled = !ready || state.activeIndex <= 0;
  $("#next-paper").disabled = !ready || state.activeIndex >= state.papers.length - 1;
  if (!paper) {
    $("#active-paper-title").textContent = state.sessionReady ? t("noActivePaper") : t("noSession");
    $("#active-paper-subtitle").textContent = state.sessionReady ? "" : t("noSession");
    $("#paper-position").textContent = "—";
    renderBlankAnnotation();
    return;
  }
  $("#active-paper-title").textContent = paper.title || t("noTitle");
  $("#active-paper-subtitle").textContent = `${paper.sample_id} · ${paper.paper_id || "—"} · arXiv ${paper.selected_vN || "—"}`;
  const periodChip = $("#active-period");
  periodChip.textContent = periodLabel(paper.period);
  periodChip.dataset.period = paper.period || "";
  $("#active-area").textContent = [paper.area_code, paper.area_name].filter(Boolean).join(" · ") || "—";
  $("#paper-position").textContent = `${state.activeIndex + 1} ${t("of")} ${state.papers.length}`;
  renderAnnotation();
}
function renderBlankAnnotation() {
  $$('[data-score-key]').forEach((button) => { button.setAttribute("aria-pressed", "false"); button.disabled = true; });
  $$('[data-version-difference-key]').forEach((input) => { input.checked = false; input.disabled = true; });
  $("#version-notes").value = "";
  $("#version-notes").disabled = true;
  $("#reviewed-full-scope").checked = false;
  $("#reviewed-full-scope").disabled = true;
  $("#version-notes-count").textContent = "0 / 12000";
  $("#complete-review").disabled = true;
  $("#complete-review").removeAttribute("data-completed");
  $("#validation-message").textContent = "";
  $("#validation-message").removeAttribute("data-kind");
  for (const side of ["compiled", "official"]) clearViewer(side, t("pdfWait"));
}
function renderAnnotation() {
  const row = activeAnnotation();
  if (!row) { renderBlankAnnotation(); return; }
  for (const key of SCORE_KEYS) {
    const score = row.scores?.[key] ?? null;
    $$('[data-score-key="' + key + '"]').forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.option === String(score)));
      button.disabled = false;
    });
  }
  for (const input of $$('[data-version-difference-key]')) {
    input.checked = row.version_differences.includes(input.dataset.versionDifferenceKey);
    input.disabled = false;
  }
  $("#version-notes").value = row.version_notes;
  $("#version-notes").disabled = false;
  $("#version-notes-count").textContent = Array.from(row.version_notes).length + " / 12000";
  $("#reviewed-full-scope").checked = row.reviewed_full_scope === true;
  $("#reviewed-full-scope").disabled = false;
  $("#complete-review").disabled = false;
  $("#complete-review").dataset.completed = String(row.status === "completed");
  $("#complete-review").textContent = row.status === "completed" ? t("reopenPaper") : t("markComplete");
  renderValidation(false);
}

function getDimension(key) { return state.rubric?.dimensions?.find((dimension) => dimension.key === key); }
function renderRubric() {
  if (!state.rubric) return;
  $("#rubric-version").textContent = state.rubric.version || "—";
  renderGuidance();
  renderScoreCards();
  renderVersionDifferences();
}
function renderGuidance() {
  const guidance = state.guidance;
  if (!guidanceIsComplete(guidance)) return;
  $("#guidance-title").textContent = localized(guidance.title);
  $("#guidance-scope").textContent = localized(guidance.scope);
  $("#guidance-quick-rules").replaceChildren(
    ...guidance.quick_rules.map((rule) => element("li", "", localized(rule))),
  );
  $("#publication-notice-title").textContent = localized(guidance.publication_notice.title);
  $("#publication-notice-text").textContent = localized(guidance.publication_notice.text);
  $("#guidance-details-title").textContent = localized(guidance.details_title);
  $("#guidance-expanded-items").replaceChildren(...guidance.details.map((item) => {
    const section = element("section", "guidance-detail");
    section.append(element("h4", "", localized(item.title)), element("p", "", localized(item.text)));
    return section;
  }));
  $("#guidance-revision").textContent = guidance.version;
}
function renderScoreCards() {
  const cards = SCORE_KEYS.map((key) => {
    const dimension = getDimension(key);
    if (!dimension) return element("div", "score-card", t("rubricMissing"));
    const titleText = state.language === "zh" ? dimension.label_zh || dimension.label : dimension.label;
    const card = element("section", "score-card");
    card.dataset.key = key;
    const header = element("div", "score-card-header");
    const titleGroup = element("div");
    titleGroup.append(element("h4", "", titleText), element("p", "", localized(dimension.description)));
    header.append(titleGroup, element("code", "score-key", key));
    card.append(header);

    const options = element("div", "score-options");
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", t("scoreFor") + " " + titleText);
    for (let score = 1; score <= 5; score += 1) {
      options.append(makeScoreButton(key, String(score), String(score), localized(dimension.scale[String(score)])));
    }
    if (dimension.allows_na) options.append(makeScoreButton(key, "na", t("na"), t("naHelp")));
    options.append(makeScoreButton(key, "uncertain", t("uncertain"), t("uncertain")));
    card.append(options);

    const details = element("details", "score-scale-details");
    details.open = true;
    details.append(element("summary", "", t("scoreScale")));
    const list = element("ol", "score-scale-list");
    for (let score = 1; score <= 5; score += 1) {
      const item = element("li");
      item.append(element("b", "", String(score)), element("span", "", localized(dimension.scale[String(score)])));
      list.append(item);
    }
    details.append(list);
    card.append(details);
    if (key === "overall_quality") card.append(element("p", "overall-rule", t("overallDirect")));
    if (key === "visual_integrity") card.append(element("p", "overall-rule visual-rule", t("visualTargetOnly")));
    if (dimension.allows_na) card.append(element("p", "score-option-help", t("naHelp")));
    return card;
  });
  $("#rubric-scoring").replaceChildren(...cards);
}
function renderVersionDifferences() {
  const list = $("#version-difference-list");
  const specs = state.rubric?.version_difference_flags || [];
  list.replaceChildren(...FLAG_KEYS.map((key) => {
    const spec = specs.find((item) => item.key === key);
    const label = element("label", "flag-option");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.versionDifferenceKey = key;
    const check = element("span", "flag-check");
    check.setAttribute("aria-hidden", "true");
    const text = spec ? (state.language === "zh" ? spec.label_zh : spec.label) : key;
    label.append(input, check, element("span", "", text));
    return label;
  }));
}
function makeScoreButton(key, option, label, definition) {
  const button = element("button", "score-option", label);
  button.type = "button";
  button.dataset.scoreKey = key;
  button.dataset.option = option;
  button.setAttribute("aria-pressed", "false");
  button.title = definition || t("scoreFor") + " " + key + ": " + label;
  button.setAttribute("aria-label", t("scoreFor") + " " + key + ": " + label + (definition ? ". " + definition : ""));
  return button;
}
function validationErrors(row, { completed = false } = {}) {
  const details = qualityAnnotationErrors(row, { completed });
  const messages = [];
  if (details.some((item) => item.key.startsWith("scores.") && item.error === "required")) {
    messages.push(t("missingScores"));
  }
  if (details.some((item) => item.key === "reviewed_full_scope" && item.error === "required")) {
    messages.push(t("noFullScope"));
  }
  if (details.some((item) => !(item.key.startsWith("scores.") && item.error === "required") &&
    !(item.key === "reviewed_full_scope" && item.error === "required"))) {
    messages.push(t("invalidAnnotation"));
  }
  return messages;
}
function renderValidation(showAll) {
  const row = activeAnnotation();
  if (!row) return;
  const completed = showAll || row.status === "completed";
  const errors = validationErrors(row, { completed });
  const message = $("#validation-message");
  if (row.status === "completed" && errors.length === 0) {
    message.dataset.kind = "success";
    message.textContent = t("completed");
  } else if (showAll && errors.length) {
    message.dataset.kind = "error";
    message.textContent = errors.join(" ");
  } else {
    message.removeAttribute("data-kind");
    message.textContent = "";
  }
  $("#complete-review").dataset.completed = String(row.status === "completed");
  $("#complete-review").textContent = row.status === "completed" ? t("reopenPaper") : t("markComplete");
}
function toggleComplete() {
  const row = activeAnnotation();
  if (!row) return;
  if (row.status === "completed") {
    mutateActive((annotation) => { annotation.status = "draft"; });
    renderValidation(false);
    setToast(t("draftSaved"));
    return;
  }
  const errors = validationErrors(row, { completed: true });
  if (errors.length) { renderValidation(true); setToast(errors[0], "error", 5000); return; }
  mutateActive((annotation) => { annotation.status = "completed"; }, { keepCompleted: true });
  renderPaperList();
  renderProgress();
  renderValidation(false);
  flushSave(true).then((saved) => { if (saved) setToast(t("completedSaved"), "success"); });
}
function mutateActive(mutator, options = {}) {
  if (!state.sessionReady || !state.activeSampleId) return;
  const row = activeAnnotation();
  mutator(row);
  row.updated_at = nowIso();
  if (row.status === "completed" && !options.keepCompleted) row.status = "draft";
  state.record.updated_at = row.updated_at;
  state.dirty = true;
  state.dirtyVersion += 1;
  state.localRecovery = null;
  state.localRecoveryConflict = false;
  storeLocalRecovery();
  renderSaveStatus();
  renderProgress();
  renderPaperList();
  renderValidation(false);
  scheduleSave();
}
function setScore(key, value) {
  if (!SCORE_KEYS.includes(key) || (value === "na" && key !== "technical_presentation")) return;
  const row = activeAnnotation();
  if (!row) return;
  const current = row.scores?.[key] ?? null;
  const next = String(current) === value ? null : (value === "uncertain" || value === "na" ? value : Number(value));
  if (next !== null && ![1, 2, 3, 4, 5, "uncertain", "na"].includes(next)) return;
  mutateActive((annotation) => { annotation.scores[key] = next; });
  renderAnnotation();
}
function updateVersionDifference(key, checked) {
  if (!FLAG_KEYS.includes(key)) return;
  mutateActive((row) => {
    const values = Array.isArray(row.version_differences) ? row.version_differences : [];
    row.version_differences = checked ? [...new Set([...values, key])] : values.filter((value) => value !== key);
  }, { keepCompleted: true });
}
function updateVersionNotes() {
  const node = $("#version-notes");
  const value = node.value;
  $("#version-notes-count").textContent = Array.from(value).length + " / 12000";
  mutateActive((row) => { row.version_notes = value; }, { keepCompleted: true });
}

function renderSaveStatus() {
  if (state.saveBlocked) { setSaveState("conflict", t("conflict")); return; }
  if (state.savingPromise) { setSaveState("saving", t("saving")); return; }
  if (state.switching) { setSaveState("saving", t("switchingSave")); return; }
  if (state.dirty) {
    const valid = isMatchingRecord(state.record, state.annotatorId);
    setSaveState(state.saveError || !valid ? "error" : "idle", state.saveError ? t("saveFailed") : !valid ? t("recordInvalid") : t("unsaved"));
    return;
  }
  if (state.sessionLoading) { setSaveState("saving", t("loadingSession")); return; }
  if (state.startupErrorKey) { setSaveState("error", `${t(state.startupErrorKey)}${state.startupErrorDetail ? ` ${state.startupErrorDetail}` : ""}`); return; }
  if (!state.initialized) { setSaveState("saving", t("connecting")); return; }
  if (!state.rubricReady) { setSaveState("error", t("rubricMissing")); return; }
  if (!state.guidanceReady) { setSaveState("error", t("guidanceInvalid")); return; }
  if (state.sessionErrorKey) { setSaveState("error", `${t(state.sessionErrorKey)}${state.sessionErrorDetail ? ` ${state.sessionErrorDetail}` : ""}`); return; }
  if (!state.sessionReady) { setSaveState("idle", t("sessionNotLoaded")); return; }
  if (state.record && !isMatchingRecord(state.record, state.annotatorId)) { setSaveState("error", t("recordInvalid")); return; }
  setSaveState(state.record?.revision > 0 ? "saved" : "idle", state.record?.revision > 0 ? t("saved") : t("noSavedWork"));
}
function renderLoginState() {
  const login = $("#login-screen");
  const app = $("#annotation-app");
  if (!login || !app) return;
  const inApp = state.sessionReady;
  login.classList.toggle("is-hidden", inApp);
  app.classList.toggle("is-hidden", !inApp);
  $("#save-status").classList.toggle("is-hidden", !inApp);

  const input = $("#annotator-id");
  const accessCode = $("#annotator-code");
  const loginError = $("#login-error");
  const errorKey = state.loginErrorKey || state.sessionErrorKey || state.startupErrorKey ||
    (state.initialized && !state.rubricReady ? "rubricMissing" : "");
  const errorDetail = state.sessionErrorKey ? state.sessionErrorDetail : state.startupErrorDetail;
  if (errorKey) {
    loginError.textContent = `${t(errorKey)}${errorDetail ? ` ${errorDetail}` : ""}`;
    loginError.classList.remove("is-hidden");
  } else {
    loginError.textContent = "";
    loginError.classList.add("is-hidden");
  }
  const canLogin = state.initialized && state.rubricReady && state.guidanceReady && !state.startupErrorKey &&
    !state.initializing && !state.sessionLoading && !state.switching;
  const hasCurrentProfile = Boolean(state.currentProfileRecord && state.currentProfileId);
  const hasProfileSession = hasCurrentProfile || state.profileSessionUnknown;
  const revealingRecovery = Boolean(state.recoveryReveal);
  const hasPendingRegistration = Boolean(state.pendingRegistration);
  $("#current-profile-panel").classList.toggle("is-hidden", !hasProfileSession || revealingRecovery);
  $("#login-mode-panel").classList.toggle("is-hidden", hasProfileSession || revealingRecovery);
  $("#recovery-code-panel").classList.toggle("is-hidden", !revealingRecovery);
  $("#annotator-code-label").classList.toggle("is-hidden", state.authMode !== "restore");
  accessCode.classList.toggle("is-hidden", state.authMode !== "restore");
  $("#recovery-code-hint").classList.toggle("is-hidden", state.authMode !== "restore");
  input.disabled = !canLogin || hasProfileSession || revealingRecovery || hasPendingRegistration;
  accessCode.disabled = !canLogin || hasProfileSession || revealingRecovery || state.authMode !== "restore" || hasPendingRegistration;
  accessCode.required = state.authMode === "restore";
  input.setAttribute("aria-invalid", String(["annotatorRequired", "invalidAnnotator", "nameTaken"].includes(errorKey)));
  accessCode.setAttribute("aria-invalid", String(state.authMode === "restore" && ["recoveryCodeRequired", "invalidCredentials"].includes(errorKey)));
  $("#mode-create-profile").classList.toggle("is-active", state.authMode === "create");
  $("#mode-restore-profile").classList.toggle("is-active", state.authMode === "restore");
  $("#mode-create-profile").setAttribute("aria-pressed", String(state.authMode === "create"));
  $("#mode-restore-profile").setAttribute("aria-pressed", String(state.authMode === "restore"));
  $("#mode-create-profile").disabled = !canLogin || hasProfileSession || revealingRecovery || hasPendingRegistration;
  $("#mode-restore-profile").disabled = !canLogin || hasProfileSession || revealingRecovery || hasPendingRegistration;
  const submit = $("#load-session");
  submit.disabled = !canLogin || hasProfileSession || revealingRecovery;
  submit.textContent = t(state.authMode === "create" ? "createProfileButton" : "restoreProfileButton");
  $("#continue-profile").disabled = !canLogin || !hasCurrentProfile;
  $("#use-another-profile").disabled = !canLogin || !hasProfileSession;
  $("#current-profile-nickname").textContent = state.currentProfileId || t("currentProfileUnknown");
  $("#download-recovery-code").disabled = !revealingRecovery;
  $("#continue-after-recovery").disabled = !revealingRecovery || !$("#recovery-code-saved").checked || state.sessionLoading;
  $("#retry-startup").classList.toggle("is-hidden", !state.startupErrorKey);
  $("#retry-startup").disabled = state.initializing;

  const status = $("#login-status");
  if (state.initializing) status.textContent = t("preparingStudy");
  else if (state.startupErrorKey) status.textContent = t("setupFailed");
  else if (!state.initialized) status.textContent = t("preparingStudy");
  else if (state.sessionLoading) status.textContent = t("loadingSession");
  else if (!state.rubricReady) status.textContent = t("rubricMissing");
  else if (!state.guidanceReady) status.textContent = t("guidanceInvalid");
  else if (state.sessionErrorKey) status.textContent = t("sessionLoadFailed");
  else if (revealingRecovery) status.textContent = t("recoveryCodeTitle");
  else if (hasProfileSession) status.textContent = t("currentProfileReady");
  else status.textContent = t(state.authMode === "create" ? "readyToCreate" : "readyToRestore");
  $("#login-spinner").classList.toggle("is-hidden", !state.initializing && !state.sessionLoading);
  login.setAttribute("aria-busy", String(state.initializing || state.sessionLoading));
}
function renderSessionControls() {
  const app = $("#annotation-app");
  if (app) {
    app.inert = false;
    app.setAttribute("aria-busy", "false");
  }
  const ready = state.sessionReady && !state.sessionLoading && !state.switching;
  $("#save-button").disabled = !ready;
  $("#switch-annotator").disabled = !state.sessionReady || state.sessionLoading || state.switching;
}
function renderDynamicLabels() {
  const title = $("#dataset-title");
  if (title) title.textContent = state.manifest ? t("studyTitle") : state.startupErrorKey ? t("setupFailed") : t("loading");
  const paper = activePaper();
  for (const id of ["compiled", "official"]) {
    const meta = $(`[data-pdf-meta="${id}"]`);
    if (!meta) continue;
    const viewer = state.viewers[id];
    const info = paper ? (id === "compiled" ? paper.compiled_pdf : paper.official_pdf) : null;
    const pageCount = viewer?.pageCount ?? (viewer ? null : Number.isInteger(info?.pages) ? info.pages : null);
    meta.textContent = Number.isInteger(pageCount) && pageCount > 0
      ? `${pageCount} ${state.language === "zh" ? "页" : "pages"}`
      : t("pageCountPending");
  }
}
function scheduleSave() {
  if (state.saveBlocked || !state.sessionReady) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => flushSave(false), 700);
}
async function flushSave(manual) {
  clearTimeout(state.saveTimer);
  if (!state.sessionReady || !state.record) return false;
  if (!state.dirty && !state.savingPromise) {
    if (manual) setToast(state.record.revision > 0 ? t("saved") : t("noChanges"), state.record.revision > 0 ? "success" : "info");
    return true;
  }
  if (state.saveBlocked) { setToast(t("conflict"), "error", 7000); return false; }
  if (state.savingPromise) {
    await state.savingPromise;
    return state.dirty && !state.saveBlocked ? flushSave(manual) : !state.dirty;
  }
  state.savingPromise = saveLoop();
  renderSaveStatus();
  let result = false;
  try { result = await state.savingPromise; }
  finally { state.savingPromise = null; renderSaveStatus(); }
  if (!result && manual && state.saveError) addRecoveryActions();
  return result;
}
async function saveLoop() {
  if (!isMatchingRecord(state.record, state.annotatorId)) {
    state.saveError = "quality_record_invalid";
    const message = t("recordInvalid");
    setSaveState("error", message);
    setToast(message, "error", 7000);
    storeLocalRecovery();
    return false;
  }
  while (state.dirty && !state.saveBlocked) {
    const version = state.dirtyVersion;
    const snapshot = structuredClone(state.record);
    snapshot.updated_at = nowIso();
    try {
      if (!state.hosted) throw Object.assign(new Error(), { code: "service_unavailable" });
      const response = await state.hosted.save(state.annotatorId, snapshot, "save");
      const serverRecord = response.record;
      if (!isMatchingRecord(serverRecord, state.annotatorId) || serverRecord.revision <= snapshot.revision) {
        throw Object.assign(new Error(), { code: "service_unavailable" });
      }
      if (serverRecord && Number.isInteger(serverRecord.revision)) state.record.revision = serverRecord.revision;
      if (serverRecord?.created_at) state.record.created_at = serverRecord.created_at;
      if (serverRecord?.updated_at) state.record.updated_at = serverRecord.updated_at;
      state.saveError = "";
      if (version === state.dirtyVersion) {
        state.dirty = false;
        clearLocalRecovery();
        $("#last-saved").textContent = `${t("savedAt")}: ${formatDate(response?.saved_at || serverRecord?.updated_at || nowIso())}`;
      }
    } catch (error) {
      if (error.status === 409) {
        state.saveBlocked = true;
        state.saveError = error.message;
        state.dirty = true;
        storeLocalRecovery();
        setSaveState("conflict", t("conflict"));
        addRecoveryActions();
        setToast(t("conflict"), "error", 7000);
        return false;
      }
      state.saveError = error.message;
      state.dirty = true;
      storeLocalRecovery();
      setSaveState("error", t("saveFailed"));
      addRecoveryActions();
      return false;
    }
  }
  if (!state.dirty) {
    renderPaperList(); renderProgress(); renderValidation(false);
    return true;
  }
  return false;
}
function snapshotRecord() { return structuredClone(state.record); }
function storeLocalRecovery() {
  if (!state.record || !state.annotatorId || !state.manifestHash) return;
  try {
    const recovery = {
      schema: "xacl.document-quality-recovery.v1",
      protocol_id: QUALITY_PROTOCOL_ID,
      saved_revision: state.record.revision,
      unsaved: true,
      record: snapshotRecord(),
    };
    localStorage.setItem(stableLocalKey(), JSON.stringify(recovery));
  } catch { /* Browser storage may be unavailable or full; the in-app recovery download remains available. */ }
}
function clearLocalRecovery() {
  try { localStorage.removeItem(stableLocalKey()); } catch { /* Ignore unavailable browser storage. */ }
  state.localRecovery = null;
  state.localRecoveryConflict = false;
  state.localRecoveryRejected = false;
  const banner = $("#recovery-banner");
  if (banner) banner.remove();
}
function readLocalRecovery() {
  state.localRecoveryRejected = false;
  try {
    const value = localStorage.getItem(stableLocalKey());
    if (!value) return null;
    const parsed = JSON.parse(value);
    const valid = parsed?.schema === "xacl.document-quality-recovery.v1" &&
      parsed.protocol_id === QUALITY_PROTOCOL_ID && parsed.unsaved === true &&
      Number.isSafeInteger(parsed.saved_revision) && isMatchingRecord(parsed.record, state.annotatorId) &&
      parsed.saved_revision === parsed.record.revision;
    if (valid) return parsed;
    state.localRecoveryRejected = true;
    localStorage.removeItem(stableLocalKey());
  } catch {
    state.localRecoveryRejected = true;
    try { localStorage.removeItem(stableLocalKey()); } catch { /* Ignore unavailable browser storage. */ }
  }
  return null;
}
function offerLocalRecovery() {
  const recovery = readLocalRecovery();
  if ($("#recovery-banner")) $("#recovery-banner").remove();
  if (!recovery && !state.localRecoveryRejected) return;
  const banner = element("div", "recovery-banner");
  banner.id = "recovery-banner";
  if (!recovery) {
    banner.append(element("span", "", t("recordRecoveryRejected")));
    $(".workspace-toolbar").insertAdjacentElement("afterend", banner);
    return;
  }
  state.localRecovery = recovery;
  state.localRecoveryConflict = recovery.record.revision !== state.record.revision;
  banner.append(element("span", "", state.localRecoveryConflict ? t("localConflict") : t("localRecovery")));
  const button = element("button", "button button-secondary", t("downloadRecovery"));
  button.type = "button";
  button.dataset.downloadRecovery = "true";
  banner.append(button);
  if (!state.localRecoveryConflict) {
    const restore = element("button", "button button-secondary", t("restoreRecovery"));
    restore.type = "button";
    restore.dataset.recoverLocal = "true";
    banner.append(restore);
  }
  $(".workspace-toolbar").insertAdjacentElement("afterend", banner);
}
function restoreLocalRecovery() {
  if (!state.localRecovery || state.localRecoveryConflict ||
      !isMatchingRecord(state.localRecovery.record, state.annotatorId)) {
    state.localRecoveryRejected = true;
    setToast(t("recordRecoveryRejected"), "error", 6000);
    offerLocalRecovery();
    return;
  }
  const backup = structuredClone(state.localRecovery.record);
  backup.revision = state.record.revision;
  state.record = backup;
  state.dirty = true;
  state.dirtyVersion += 1;
  state.saveBlocked = false;
  state.saveError = "";
  state.localRecovery = null;
  state.localRecoveryConflict = false;
  if (state.papers.length) selectResumePaper();
  const banner = $("#recovery-banner");
  if (banner) banner.remove();
  storeLocalRecovery();
  renderPaperList();
  renderProgress();
  renderSaveStatus();
  scheduleSave();
  setToast(t("recoveryRestored"), "success");
}
function addRecoveryActions() {
  if (!state.sessionReady || !$(".workspace-toolbar")) return;
  let banner = $("#recovery-banner");
  if (!banner) {
    banner = element("div", "recovery-banner");
    banner.id = "recovery-banner";
    $(".workspace-toolbar").insertAdjacentElement("afterend", banner);
  }
  banner.replaceChildren(element("span", "", state.saveBlocked ? t("conflict") : t("saveOffline")));
  const button = element("button", "button button-secondary", t("downloadRecovery"));
  button.type = "button";
  button.dataset.downloadRecovery = "true";
  banner.append(button);
}
function downloadRecovery() {
  if (!state.record) return;
  const record = state.localRecovery?.record && state.localRecoveryConflict ? state.localRecovery.record : state.record;
  const recovery = {
    schema: "xacl.document-quality-recovery.v1",
    protocol_id: QUALITY_PROTOCOL_ID,
    saved_revision: record.revision,
    unsaved: true,
    record,
  };
  const blob = new Blob([JSON.stringify(recovery, null, 2), "\n"], { type: "application/json" });
  downloadBlob(blob, QUALITY_PROTOCOL_ID + "-" + safeFilenamePart(record.annotator_id) + "-recovery.json");
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = element("a");
  link.href = url; link.download = filename; link.rel = "noopener";
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safePdfUrl(path) {
  if (typeof path !== "string" || !path.trim() || /[\\\u0000-\u001f]/.test(path)) return null;
  const value = path.trim();
  if (value.startsWith("/") || value.includes("?") || value.includes("#")) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  if (decoded.startsWith("/") || decoded.split("/").some((segment) => segment === "." || segment === "..") || decoded.includes("\\")) return null;
  const url = new URL(value, PACKAGE_BASE_URL);
  if (url.origin !== window.location.origin || !url.pathname.startsWith(PACKAGE_BASE_URL.pathname) ||
      url.search || url.hash || !url.pathname.toLowerCase().endsWith(".pdf")) return null;
  return url.href;
}
async function getPdfJs() {
  if (!state.pdfjsPromise) {
    state.pdfjsPromise = import(packageAssetUrl("vendor/pdfjs/legacy/build/pdf.mjs").href).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = packageAssetUrl("vendor/pdfjs/legacy/build/pdf.worker.mjs").href;
      return pdfjs;
    }).catch((error) => { state.pdfjsPromise = null; throw error; });
  }
  return state.pdfjsPromise;
}
function viewerState(id) {
  if (!state.viewers[id]) state.viewers[id] = { generation: 0, pdf: null, loadingTask: null, renderTask: null, page: 1, scale: null, fit: true, paperSampleId: null, pageCount: null, error: false, boundaryKey: null, resizeObserver: null };
  return state.viewers[id];
}
async function loadPaperPdfs(paper) {
  if (!paper) return;
  await Promise.all(["compiled", "official"].map(async (id) => {
    if (state.activeSampleId !== paper.sample_id) return;
    const info = id === "compiled" ? paper.compiled_pdf : paper.official_pdf;
    await loadPdf(id, info, paper.sample_id);
  }));
}
async function loadPdf(id, info, sampleId) {
  const viewer = viewerState(id);
  viewer.generation += 1;
  const generation = viewer.generation;
  cancelViewerWork(viewer);
  viewer.pdf = null; viewer.page = 1; viewer.scale = null; viewer.fit = true; viewer.paperSampleId = sampleId; viewer.error = false;
  const url = safePdfUrl(info?.path);
  const open = $(`[data-pdf-open="${id}"]`);
  const stage = $(`[data-stage="${id}"]`);
  const canvas = $(`[data-canvas="${id}"]`);
  const placeholder = $(`[data-placeholder="${id}"]`);
  const errorNode = $(`[data-error="${id}"]`);
  clearRenderedIdentity(canvas);
  stage.setAttribute("aria-busy", "true");
  setViewerLoading(id, t("connecting"), true);
  open.href = "#";
  open.setAttribute("aria-disabled", "true");
  canvas.classList.add("is-hidden"); errorNode.classList.add("is-hidden"); placeholder.classList.remove("is-hidden");
  viewer.pageCount = Number.isInteger(info?.pages) ? info.pages : null;
  setViewerCount(id, viewer.pageCount);
  renderDynamicLabels();
  $(`[data-pdf-hash="${id}"]`).textContent = info?.sha256 ? `SHA-256 ${info.sha256}` : "SHA-256 —";
  if (!url) { showPdfError(id, t("fileNotFound")); return; }
  open.href = url; open.setAttribute("aria-disabled", "false");
  placeholder.querySelector("p").textContent = t("connecting");
  try {
    const pdfjs = await getPdfJs();
    if (generation !== viewer.generation) return;
    const options = {
      url, cMapUrl: packageAssetUrl("vendor/pdfjs/cmaps/").href, cMapPacked: true,
      standardFontDataUrl: packageAssetUrl("vendor/pdfjs/standard_fonts/").href,
      wasmUrl: packageAssetUrl("vendor/pdfjs/wasm/").href, iccUrl: packageAssetUrl("vendor/pdfjs/iccs/").href,
      useWasm: true, isEvalSupported: false,
    };
    const loadingTask = pdfjs.getDocument(options);
    viewer.loadingTask = loadingTask;
    const pdf = await loadingTask.promise;
    if (generation !== viewer.generation) { await pdf.destroy().catch(() => {}); return; }
    viewer.pdf = pdf; viewer.error = false;
    viewer.pageCount = pdf.numPages;
    setViewerCount(id, pdf.numPages);
    renderDynamicLabels();
    installResizeObserver(id);
    await renderPage(id, 1, generation);
  } catch (error) {
    if (generation !== viewer.generation) return;
    showPdfError(id, `${t("renderFailed")} ${error?.message ? String(error.message).slice(0, 220) : ""}`);
  }
}
function cancelViewerWork(viewer) {
  if (viewer.renderTask) { try { viewer.renderTask.cancel(); } catch { /* Already completed. */ } viewer.renderTask = null; }
  const oldTask = viewer.loadingTask;
  const oldPdf = viewer.pdf;
  viewer.loadingTask = null; viewer.pdf = null;
  if (oldTask) Promise.resolve(oldTask.destroy()).catch(() => {});
  else if (oldPdf) Promise.resolve(oldPdf.destroy()).catch(() => {});
}
function setViewerCount(id, count) {
  $(`[data-page-count="${id}"]`).textContent = count ? String(count) : "—";
  const input = $(`[data-page-input="${id}"]`);
  input.value = "1"; input.max = count ? String(count) : "1"; input.disabled = !count;
  for (const action of ["prev", "next", "zoom-in", "zoom-out", "fit"]) $(`[data-viewer-action="${action}"][data-viewer="${id}"]`).disabled = !count;
  updateViewerArrowAvailability();
}
function showPdfError(id, message) {
  viewerState(id).error = true;
  clearBoundaryStatuses();
  const stage = $(`[data-stage="${id}"]`);
  const canvas = $(`[data-canvas="${id}"]`);
  const placeholder = $(`[data-placeholder="${id}"]`);
  const error = $(`[data-error="${id}"]`);
  clearRenderedIdentity(canvas);
  stage.setAttribute("aria-busy", "false");
  setViewerLoading(id, "", false);
  canvas.classList.add("is-hidden"); placeholder.classList.add("is-hidden");
  error.textContent = message; error.classList.remove("is-hidden");
  setViewerCount(id, null);
  const link = $(`[data-pdf-open="${id}"]`);
  if (!link.href || link.href === "#") link.setAttribute("aria-disabled", "true");
}
function clearViewer(id, message = t("pdfWait")) {
  const viewer = viewerState(id);
  viewer.generation += 1; cancelViewerWork(viewer); viewer.paperSampleId = null;
  viewer.page = 1; viewer.scale = null; viewer.fit = true; viewer.error = false; viewer.pageCount = null;
  setBoundaryStatus(id, null);
  const canvas = $(`[data-canvas="${id}"]`);
  clearRenderedIdentity(canvas);
  $(`[data-stage="${id}"]`).setAttribute("aria-busy", "false");
  setViewerLoading(id, "", false);
  canvas.classList.add("is-hidden");
  $(`[data-error="${id}"]`).classList.add("is-hidden");
  const placeholder = $(`[data-placeholder="${id}"]`);
  placeholder.classList.remove("is-hidden");
  placeholder.querySelector("p").textContent = message;
  const link = $(`[data-pdf-open="${id}"]`); link.href = "#"; link.setAttribute("aria-disabled", "true");
  setViewerCount(id, null);
  renderDynamicLabels();
  $(`[data-pdf-hash="${id}"]`).textContent = "SHA-256 —";
}
async function renderPage(id, pageNumber, expectedGeneration) {
  const viewer = viewerState(id);
  if (!viewer.pdf || expectedGeneration !== viewer.generation) return;
  viewer.renderSequence = (viewer.renderSequence || 0) + 1;
  const renderSequence = viewer.renderSequence;
  const page = Math.max(1, Math.min(viewer.pdf.numPages, Math.round(pageNumber)));
  viewer.page = page;
  const pageInput = $(`[data-page-input="${id}"]`);
  pageInput.value = String(page);
  const stage = $(`[data-stage="${id}"]`);
  const canvas = $(`[data-canvas="${id}"]`);
  const hasCurrentPaperPage = canvas.dataset.renderedSample === viewer.paperSampleId && Boolean(canvas.dataset.renderedPage);
  stage.setAttribute("aria-busy", "true");
  setViewerLoading(id, t("renderingPage"), true);
  if (!hasCurrentPaperPage) canvas.classList.add("is-hidden");
  canvas.setAttribute("aria-label", `${t(id === "compiled" ? "canvasTarget" : "canvasOfficial")} · ${t("page")} ${page} / ${viewer.pdf.numPages}`);
  if (viewer.renderTask) { try { viewer.renderTask.cancel(); } catch { /* Already finished. */ } viewer.renderTask = null; }
  try {
    const pdfPage = await viewer.pdf.getPage(page);
    if (expectedGeneration !== viewer.generation || renderSequence !== viewer.renderSequence) return;
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const fitScale = Math.max(.2, Math.min(2.3, (stage.clientWidth - 34) / baseViewport.width));
    const scale = viewer.fit || !viewer.scale ? fitScale : viewer.scale;
    viewer.scale = scale;
    const viewport = pdfPage.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(viewport.width * dpr);
    canvas.height = Math.ceil(viewport.height * dpr);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    const context = canvas.getContext("2d", { alpha: false });
    const renderTask = pdfPage.render({ canvasContext: context, viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0], background: "#ffffff" });
    viewer.renderTask = renderTask;
    await renderTask.promise;
    if (expectedGeneration !== viewer.generation || renderSequence !== viewer.renderSequence) return;
    viewer.renderTask = null;
    if (viewer.error) {
      viewer.error = false;
      viewer.pageCount = viewer.pdf.numPages;
      setViewerCount(id, viewer.pdf.numPages);
      pageInput.value = String(page);
      $(`[data-error="${id}"]`).classList.add("is-hidden");
    }
    canvas.dataset.renderedSample = viewer.paperSampleId;
    canvas.dataset.renderedPage = String(page);
    canvas.classList.remove("is-hidden");
    $(`[data-placeholder="${id}"]`).classList.add("is-hidden");
    stage.setAttribute("aria-busy", "false");
    setViewerLoading(id, "", false);
    $(`[data-zoom-label="${id}"]`).textContent = `${Math.round(scale * 100)}%`;
  } catch (error) {
    if (error?.name === "RenderingCancelledException" || expectedGeneration !== viewer.generation || renderSequence !== viewer.renderSequence) return;
    showPdfError(id, `${t("pageUnavailable")} ${error?.message ? String(error.message).slice(0, 180) : ""}`);
  }
}
function clearRenderedIdentity(canvas) {
  delete canvas.dataset.renderedSample;
  delete canvas.dataset.renderedPage;
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = "";
  canvas.style.height = "";
}
function setViewerLoading(id, message, visible) {
  const stage = $(`[data-stage="${id}"]`);
  let status = $(`[data-loading-status="${id}"]`);
  if (!status) {
    status = element("div", "pdf-loading-status is-hidden");
    status.dataset.loadingStatus = id;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    stage.append(status);
  }
  status.textContent = message;
  status.classList.toggle("is-hidden", !visible);
}
function installResizeObserver(id) {
  const viewer = viewerState(id);
  if (viewer.resizeObserver) return;
  if (typeof ResizeObserver === "undefined") return;
  viewer.resizeObserver = new ResizeObserver(() => {
    if (viewer.fit && viewer.pdf) renderPage(id, viewer.page, viewer.generation);
  });
  viewer.resizeObserver.observe($(`[data-stage="${id}"]`));
}
function goToPage(id, page) {
  const viewer = viewerState(id);
  if (!viewer.pdf || !Number.isFinite(page)) return;
  const targetPage = Math.max(1, Math.min(viewer.pdf.numPages, Math.round(page)));
  if (targetPage === viewer.page && !viewer.error) {
    $(`[data-page-input="${id}"]`).value = String(targetPage);
    return;
  }
  renderPage(id, targetPage, viewer.generation);
}
function setPdfSyncNavigation(enabled) {
  state.syncPdfNavigation = Boolean(enabled);
  clearBoundaryStatuses();
  updateViewerArrowAvailability();
}
function synchronizedViewersReady() {
  const sampleId = state.activeSampleId;
  return Boolean(sampleId && ["compiled", "official"].every((id) => {
    const viewer = viewerState(id);
    return viewer.pdf && !viewer.error && viewer.paperSampleId === sampleId;
  }));
}
function updateViewerArrowAvailability() {
  const synchronizedReady = !state.syncPdfNavigation || synchronizedViewersReady();
  for (const id of ["compiled", "official"]) {
    const viewer = viewerState(id);
    const sideReady = viewer.pdf && !viewer.error && viewer.paperSampleId === state.activeSampleId;
    for (const action of ["prev", "next"]) {
      const button = $(`[data-viewer-action="${action}"][data-viewer="${id}"]`);
      if (button) button.disabled = !sideReady || !synchronizedReady;
    }
  }
}
function setBoundaryStatus(id, key) {
  const viewer = viewerState(id);
  viewer.boundaryKey = key || null;
  const status = $(`[data-page-status="${id}"]`);
  if (!status) return;
  status.textContent = viewer.boundaryKey ? t(viewer.boundaryKey) : "";
  status.classList.toggle("is-hidden", !viewer.boundaryKey);
}
function clearBoundaryStatuses() {
  for (const id of ["compiled", "official"]) setBoundaryStatus(id, null);
}
function renderBoundaryStatuses() {
  for (const id of ["compiled", "official"]) {
    const viewer = viewerState(id);
    const status = $(`[data-page-status="${id}"]`);
    if (!status) continue;
    status.textContent = viewer.boundaryKey ? t(viewer.boundaryKey) : "";
    status.classList.toggle("is-hidden", !viewer.boundaryKey);
  }
}
function moveSynchronizedViewers(delta) {
  if (!synchronizedViewersReady()) return;
  for (const id of ["compiled", "official"]) {
    const viewer = viewerState(id);
    const targetPage = Math.max(1, Math.min(viewer.pdf.numPages, viewer.page + delta));
    const boundaryKey = delta < 0 && targetPage <= 1
      ? "firstPageReached"
      : delta > 0 && targetPage >= viewer.pdf.numPages ? "lastPageReached" : null;
    setBoundaryStatus(id, boundaryKey);
    if (targetPage !== viewer.page) renderPage(id, targetPage, viewer.generation);
  }
}
function handleViewerAction(id, action) {
  const viewer = viewerState(id);
  if (!viewer.pdf) return;
  if (action === "prev" && state.syncPdfNavigation) moveSynchronizedViewers(-1);
  else if (action === "next" && state.syncPdfNavigation) moveSynchronizedViewers(1);
  else if (action === "prev") goToPage(id, viewer.page - 1);
  else if (action === "next") goToPage(id, viewer.page + 1);
  else if (action === "fit") { viewer.fit = true; viewer.scale = null; renderPage(id, viewer.page, viewer.generation); }
  else if (action === "zoom-in" || action === "zoom-out") {
    viewer.fit = false;
    viewer.scale = Math.max(.35, Math.min(3.5, (viewer.scale || .9) + (action === "zoom-in" ? .15 : -.15)));
    renderPage(id, viewer.page, viewer.generation);
  }
}
function onWindowResize() {
  for (const id of ["compiled", "official"]) {
    const viewer = viewerState(id);
    if (viewer.fit && viewer.pdf) renderPage(id, viewer.page, viewer.generation);
  }
}
function renderViewerFocusLayout() {
  const focusMode = Boolean(state.focusViewers);
  const grid = $("#viewer-grid");
  const toolbar = $("#viewer-focus-toolbar");
  const normalSlot = $("#sync-pdf-pages-normal-slot");
  const focusSlot = $("#sync-pdf-pages-focus-slot");
  const syncToggle = $(".sync-toggle");
  const focusButton = $("#focus-viewers");
  const exitButton = $("[data-exit-focus]", toolbar);

  const targetSlot = focusMode ? focusSlot : normalSlot;
  if (syncToggle.parentElement !== targetSlot) targetSlot.append(syncToggle);
  grid.classList.toggle("is-focus", focusMode);
  toolbar.hidden = !focusMode;
  toolbar.classList.toggle("is-hidden", !focusMode);
  focusButton.setAttribute("aria-pressed", String(focusMode));
  focusButton.textContent = focusMode ? t("returnToAnnotation") : t("expandViewers");
  exitButton.textContent = t("returnToAnnotation");
}
function toggleViewerFocus() {
  state.focusViewers = !state.focusViewers;
  renderViewerFocusLayout();
  (state.focusViewers ? $("#sync-pdf-pages") : $("#focus-viewers")).focus({ preventScroll: true });
  onWindowResize();
}

setLanguage(state.language);
initialize();
