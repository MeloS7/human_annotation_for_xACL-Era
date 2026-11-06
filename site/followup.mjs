import { randomRecoveryCode, stripPublishableKeyBearer } from "./cloud.mjs?v=20261106-followup49-v1";

export const FOLLOWUP_CONFIG_SCHEMA = "xacl.followup49-config.v1";
export const FOLLOWUP_MANIFEST_SCHEMA = "xacl.low-score-followup-manifest.v1";
export const FOLLOWUP_GUIDANCE_SCHEMA = "xacl.low-score-followup-guidance.v1";
export const FOLLOWUP_EVIDENCE_SCHEMA = "xacl.low-score-followup-evidence.v1";
export const FOLLOWUP_ISSUE_IDS = Object.freeze([
  "text_integrity_readability", "document_structural_integrity", "nontext_asset_integrity",
  "overall_data_usability", "pdf_visual_integrity", "page_9_coverage",
]);
export const FOLLOWUP_VERDICTS = Object.freeze(["confirmed", "not_found", "insufficient_evidence"]);
export const FOLLOWUP_CATEGORIES = Object.freeze([
  "source_content", "pdf_rendering", "outside_window", "coverage_uncertain", "other",
]);

const RPC = Object.freeze({
  health: "xacl_followup49_annotation_health",
  register: "xacl_followup49_register_annotator",
  resume: "xacl_followup49_resume_annotator",
  current: "xacl_followup49_current_annotations",
  load: "xacl_followup49_load_annotations",
  save: "xacl_followup49_save_annotations",
});
const RECORD_KEYS = Object.freeze([
  "schema", "protocol_id", "dataset_id", "manifest_sha256", "rubric_version",
  "annotator_id", "revision", "created_at", "updated_at", "annotations",
]);
const FINDING_KEYS = Object.freeze(["verdict", "category", "note"]);
const ROW_KEYS = Object.freeze(["status", "updated_at", "findings"]);
const ISSUE_LABELS = Object.freeze({
  text_integrity_readability: "Text integrity and readability",
  document_structural_integrity: "Document structural integrity",
  nontext_asset_integrity: "Non-text asset integrity",
  overall_data_usability: "Overall data usability",
  pdf_visual_integrity: "PDF visual integrity",
  page_9_coverage: "Page 9 coverage",
});
const CATEGORY_LABELS = Object.freeze({
  source_content: "Source content",
  pdf_rendering: "PDF rendering",
  outside_window: "Outside the assigned window",
  coverage_uncertain: "Coverage uncertain",
  other: "Other",
});
const VERDICT_LABELS = Object.freeze({
  confirmed: "Confirmed",
  not_found: "Not found",
  insufficient_evidence: "Insufficient evidence",
});
const $ = (selector, root = document) => root.querySelector(selector);
const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const sha256Pattern = /^[a-f0-9]{64}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const validTimestamp = (value) => typeof value === "string" && value.length <= 64 &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function exactlyKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => owns(value, key));
}

export function followupStorageKey({ origin, supabaseUrl, studyId }) {
  const project = new URL(supabaseUrl).hostname;
  return `xacl-${`${origin}|${project}|${studyId}`.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

export function validateFollowupConfig(config) {
  if (!isObject(config) || config.schema !== FOLLOWUP_CONFIG_SCHEMA ||
      config.study_id !== "revisionlens-alignment30-v1" ||
      config.dataset_id !== "revisionlens-low-score49-v1" ||
      config.protocol_id !== "latex-data-usability-followup49-v1" ||
      config.record_schema !== "xacl.low-score-followup-annotations.v1" ||
      !sha256Pattern.test(config.manifest_sha256 || "") ||
      !sha256Pattern.test(config.rubric_sha256 || "") ||
      !sha256Pattern.test(config.guidance_sha256 || "") ||
      !sha256Pattern.test(config.evidence_sha256 || "") ||
      typeof config.rubric_version !== "string" || !config.rubric_version ||
      typeof config.guidance_version !== "string" || !config.guidance_version) {
    throw new Error("The follow-up configuration is invalid.");
  }
  return config;
}

export function validateFollowupManifest(manifest, config) {
  if (!isObject(manifest) || manifest.schema !== FOLLOWUP_MANIFEST_SCHEMA ||
      manifest.dataset_id !== config.dataset_id || !Array.isArray(manifest.papers) || manifest.papers.length !== 49) {
    throw new Error("The 49-paper manifest is missing or invalid.");
  }
  const seen = new Set();
  for (const paper of manifest.papers) {
    if (!isObject(paper) || typeof paper.sample_id !== "string" || !/^J\d{3}$/.test(paper.sample_id) ||
        seen.has(paper.sample_id) || typeof paper.paper_id !== "string" || !paper.paper_id ||
        typeof paper.title !== "string" || !paper.title || typeof paper.selected_vN !== "string" || !paper.selected_vN ||
        !["priority", "secondary"].includes(paper.priority) || !Number.isInteger(paper.total_pdf_pages) || paper.total_pdf_pages < 1 ||
        !Array.isArray(paper.assigned_physical_pages) || paper.assigned_physical_pages.length < 1 ||
        !paper.assigned_physical_pages.every((page) => Number.isInteger(page) && page >= 1 && page <= paper.total_pdf_pages) ||
        new Set(paper.assigned_physical_pages).size !== paper.assigned_physical_pages.length ||
        !isObject(paper.compiled_pdf) || typeof paper.compiled_pdf.file !== "string" ||
        paper.compiled_pdf.file.startsWith("/") || paper.compiled_pdf.file.split(/[\\/]/).includes("..") ||
        !/\.pdf$/i.test(paper.compiled_pdf.file) || !Number.isSafeInteger(paper.compiled_pdf.bytes) || paper.compiled_pdf.bytes < 1 ||
        !sha256Pattern.test(paper.compiled_pdf.sha256 || "") || !Array.isArray(paper.issues) || paper.issues.length < 1) {
      throw new Error("The 49-paper manifest contains an invalid paper entry.");
    }
    seen.add(paper.sample_id);
    const issueIds = new Set();
    for (const issue of paper.issues) {
      if (!isObject(issue) || !FOLLOWUP_ISSUE_IDS.includes(issue.id) || issueIds.has(issue.id)) {
        throw new Error(`The manifest has an invalid flagged issue for ${paper.sample_id}.`);
      }
      issueIds.add(issue.id);
    }
  }
  if (!manifest.papers.some((paper) => paper.priority === "priority")) {
    throw new Error("The follow-up manifest has no priority papers.");
  }
  return manifest;
}

export function sortFollowupPapers(papers) {
  return [...papers].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority === "priority" ? -1 : 1;
    return papers.indexOf(left) - papers.indexOf(right);
  });
}

export function validateFollowupGuidance(guidance, config) {
  if (!isObject(guidance) || guidance.schema !== FOLLOWUP_GUIDANCE_SCHEMA ||
      guidance.version !== config.guidance_version || typeof guidance.purpose !== "string" ||
      !Array.isArray(guidance.instructions) || !guidance.instructions.length ||
      !guidance.instructions.every((line) => typeof line === "string" && line.trim()) ||
      typeof guidance.scope_note !== "string" || !isObject(guidance.verdicts) ||
      FOLLOWUP_VERDICTS.some((verdict) => typeof guidance.verdicts[verdict] !== "string")) {
    throw new Error("The targeted-review guidance is missing or invalid.");
  }
  return guidance;
}

export function validateFollowupEvidence(evidence, manifest) {
  if (!isObject(evidence) || evidence.schema !== FOLLOWUP_EVIDENCE_SCHEMA || !isObject(evidence.papers)) {
    throw new Error("The private review-evidence file has an invalid format.");
  }
  const paperIds = new Set(manifest.papers.map((paper) => paper.sample_id));
  if (Object.keys(evidence.papers).some((sampleId) => !paperIds.has(sampleId))) {
    throw new Error("The private review-evidence file has an unknown paper ID.");
  }
  for (const paper of manifest.papers) {
    const row = evidence.papers[paper.sample_id];
    if (!isObject(row)) throw new Error(`Review evidence is missing for ${paper.sample_id}.`);
    const allowedIssues = new Set(paper.issues.map((issue) => issue.id));
    if (Object.keys(row).some((issueId) => !allowedIssues.has(issueId))) {
      throw new Error(`Review evidence has an unknown issue for ${paper.sample_id}.`);
    }
    for (const issue of paper.issues) {
      const item = row[issue.id];
      if (!exactlyKeys(item, ["gpt_reason", "gemini_reason", "scope_note"]) ||
          Object.values(item).some((value) => typeof value !== "string")) {
        throw new Error(`Review evidence is incomplete for ${paper.sample_id}.`);
      }
    }
  }
  return evidence;
}

export function normalizeBundlePath(file) {
  const path = typeof file?.webkitRelativePath === "string" && file.webkitRelativePath ? file.webkitRelativePath : file?.name;
  if (typeof path !== "string" || !path) return "";
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return (parts.length > 1 ? parts.slice(1) : parts).join("/");
}

export function findBundleFiles(fileList, expectedPath) {
  const expected = String(expectedPath || "").replaceAll("\\", "/");
  const candidates = [...fileList].filter((file) => normalizeBundlePath(file) === expected);
  return { file: candidates.length === 1 ? candidates[0] : null, count: candidates.length };
}

export function followupRecordIssue(record, config, manifest, annotatorId = undefined) {
  if (!exactlyKeys(record, RECORD_KEYS)) return "record_shape_invalid";
  if (record.schema !== config.record_schema || record.protocol_id !== config.protocol_id ||
      record.dataset_id !== config.dataset_id || record.manifest_sha256 !== config.manifest_sha256 ||
      record.rubric_version !== config.rubric_version ||
      (annotatorId !== undefined && record.annotator_id !== annotatorId) ||
      typeof record.annotator_id !== "string" || !idPattern.test(record.annotator_id)) return "record_identity_invalid";
  if (!Number.isSafeInteger(record.revision) || record.revision < 0 ||
      !validTimestamp(record.created_at) || !validTimestamp(record.updated_at) || !isObject(record.annotations)) return "record_metadata_invalid";
  const paperMap = new Map(manifest.papers.map((paper) => [paper.sample_id, paper]));
  if (Object.keys(record.annotations).some((sampleId) => !paperMap.has(sampleId))) return "record_sample_invalid";
  for (const [sampleId, row] of Object.entries(record.annotations)) {
    if (!exactlyKeys(row, ROW_KEYS) || !["draft", "completed"].includes(row.status) ||
        !validTimestamp(row.updated_at) || !isObject(row.findings)) return "record_annotation_invalid";
    const paper = paperMap.get(sampleId);
    const issueMap = new Map(paper.issues.map((issue) => [issue.id, issue]));
    if (Object.keys(row.findings).some((issueId) => !issueMap.has(issueId))) return "record_finding_unknown";
    for (const finding of Object.values(row.findings)) {
      if (!exactlyKeys(finding, FINDING_KEYS) || !FOLLOWUP_VERDICTS.includes(finding.verdict) ||
          !(finding.category === null || FOLLOWUP_CATEGORIES.includes(finding.category)) ||
          typeof finding.note !== "string" || [...finding.note].length > 2000) return "record_finding_invalid";
    }
    if (row.status === "completed" && paper.issues.some((issue) => !owns(row.findings, issue.id))) return "record_incomplete";
  }
  return null;
}

export function validateFollowupHealth(health, config) {
  return Boolean(isObject(health) && health.ready === true &&
    health.study_id === config.study_id && health.dataset_id === config.dataset_id &&
    health.protocol_id === config.protocol_id && health.manifest_sha256 === config.manifest_sha256 &&
    health.record_schema === config.record_schema && health.rubric_version === config.rubric_version &&
    health.rubric_sha256 === config.rubric_sha256 && health.guidance_version === config.guidance_version &&
    health.guidance_sha256 === config.guidance_sha256 && health.auth_mode === "anonymous_recovery_v1");
}

async function sha256Hex(bytes, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle?.digest) throw new Error("Secure file verification is unavailable in this browser.");
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchJsonWithBytes(path) {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`Could not load required review file (${response.status}).`);
  const bytes = await response.arrayBuffer();
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)), bytes }; }
  catch { throw new Error("A required review file is not valid JSON."); }
}

const state = {
  initialized: false, config: null, apiConfig: null, manifest: null, guidance: null,
  client: null, record: null, annotatorId: "", activeSampleId: "", authMode: "create",
  currentProfile: "", currentProfileRecord: null, pendingRegistration: null,
  orderedPapers: [], fileIndex: new Map(), evidence: null, pdfUrl: "", pdfLoadReady: false,
  verifiedThisSession: new Set(), dirty: false, saving: false, savePromise: null,
  editVersion: 0, saveTimer: 0, toastTimer: 0, modeSwitchLocked: false,
  bundleGeneration: 0, pdfRequestSerial: 0,
};

function errorText(error, fallback) {
  const code = String(error?.code || "");
  if (code === "invalid_credentials") return "The nickname or recovery code was not accepted.";
  if (code === "name_taken") return "That nickname is already in use. Choose another one, or restore your existing profile.";
  if (code === "profile_exists") return "This device is linked to another profile. Switch profiles or restore the intended one.";
  if (code === "revision_conflict") return "This review changed on another session. Your local edits are still here; reload only after saving or copying them.";
  if (code === "study_mismatch" || code === "invalid_record") return "The saved response does not match this review protocol. Editing has been stopped.";
  if (code === "anonymous_auth_unavailable") return "Anonymous sign-in is not enabled for this study.";
  return fallback;
}

function setConnection(message, kind = "") {
  const node = $("#connection-status");
  node.textContent = message;
  node.dataset.state = kind;
}

function setLoginError(message = "") {
  const node = $("#login-error");
  node.textContent = message;
  node.classList.toggle("hidden", !message);
}

function setSaveStatus(message, kind = "") {
  const node = $("#save-status");
  node.textContent = message;
  node.dataset.state = kind;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.remove("visible"), 3200);
}

function renderStartupFailure(message) {
  const node = $("#startup-error");
  node.textContent = message;
  node.classList.remove("hidden");
  $("#profile-submit").disabled = true;
  $("#continue-profile").disabled = true;
}

function unwrapRpc(data) {
  const payload = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!isObject(payload)) throw Object.assign(new Error(), { code: "service_unavailable" });
  if (typeof payload.error === "string" || typeof payload.code === "string") {
    throw Object.assign(new Error(), { code: payload.error || payload.code, currentRevision: payload.current_revision });
  }
  return payload;
}

async function rpc(name, args = {}) {
  if (!Object.values(RPC).includes(name) || !state.client) throw Object.assign(new Error(), { code: "service_unavailable" });
  let result;
  try { result = await state.client.rpc(name, args); }
  catch (error) { throw Object.assign(new Error(), { code: error?.code || "service_unavailable" }); }
  if (result?.error) throw Object.assign(new Error(), { code: result.error.code || result.error.details || "service_unavailable" });
  return unwrapRpc(result?.data);
}

function unwrapRecord(payload) {
  if (payload.record === null) return null;
  return isObject(payload.record) ? payload.record : payload;
}

function validateRecordOrThrow(record, annotatorId = undefined) {
  const issue = followupRecordIssue(record, state.config, state.manifest, annotatorId);
  if (issue) throw Object.assign(new Error(), { code: "invalid_record" });
  return record;
}

function newRecord(annotatorId, revision = 0) {
  const stamp = new Date().toISOString();
  return {
    schema: state.config.record_schema,
    protocol_id: state.config.protocol_id,
    dataset_id: state.config.dataset_id,
    manifest_sha256: state.config.manifest_sha256,
    rubric_version: state.config.rubric_version,
    annotator_id: annotatorId,
    revision,
    created_at: stamp,
    updated_at: stamp,
    annotations: {},
  };
}

function sortFromRecord() {
  return sortFollowupPapers(state.manifest.papers);
}

async function initialize() {
  try {
    if (!globalThis.crypto?.subtle || !globalThis.supabase?.createClient) throw new Error("Secure review services are unavailable in this browser.");
    const [configFile, manifestFile, guidanceFile, apiFile] = await Promise.all([
      fetchJsonWithBytes("./followup49/config.json"),
      fetchJsonWithBytes("./followup49/manifest.json"),
      fetchJsonWithBytes("./followup49/guidance.json"),
      fetchJsonWithBytes("./config.json"),
    ]);
    state.config = validateFollowupConfig(configFile.value);
    state.manifest = validateFollowupManifest(manifestFile.value, state.config);
    state.guidance = validateFollowupGuidance(guidanceFile.value, state.config);
    if (await sha256Hex(manifestFile.bytes) !== state.config.manifest_sha256 ||
        await sha256Hex(guidanceFile.bytes) !== state.config.guidance_sha256) {
      throw new Error("A static follow-up file failed its integrity check.");
    }
    state.apiConfig = apiFile.value;
    if (!isObject(state.apiConfig) || typeof state.apiConfig.supabase_url !== "string" ||
        typeof state.apiConfig.supabase_publishable_key !== "string") throw new Error("The public annotation-service settings are unavailable.");
    const fetchImpl = globalThis.fetch.bind(globalThis);
    const client = globalThis.supabase.createClient(state.apiConfig.supabase_url,
      state.apiConfig.supabase_publishable_key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: followupStorageKey({
            origin: globalThis.location.origin,
            supabaseUrl: state.apiConfig.supabase_url,
            studyId: state.config.study_id,
          }),
        },
        global: { fetch: stripPublishableKeyBearer(fetchImpl, state.apiConfig.supabase_publishable_key) },
      });
    if (!client?.auth || typeof client.rpc !== "function") throw new Error("The annotation service could not be initialized.");
    state.client = client;
    const health = await rpc(RPC.health);
    if (!validateFollowupHealth(health, state.config)) throw new Error("The private review service does not match this 49-paper protocol yet.");
    state.orderedPapers = sortFromRecord();
    $("#paper-count").textContent = String(state.orderedPapers.length);
    setConnection("Ready", "ready");
    const sessionResult = await client.auth.getSession();
    if (sessionResult?.error) throw new Error("Could not check the saved sign-in on this device.");
    if (sessionResult?.data?.session) {
      const current = await rpc(RPC.current);
      const record = unwrapRecord(current);
      if (record) {
        validateRecordOrThrow(record);
        state.currentProfile = record.annotator_id;
        state.currentProfileRecord = record;
        $("#current-nickname").textContent = record.annotator_id;
        $("#current-profile").classList.remove("hidden");
        $("#profile-actions").classList.add("hidden");
        setConnection(`Signed in as ${record.annotator_id}`, "ready");
      }
    }
    bindLoginEvents();
  } catch (error) {
    setConnection("Not ready", "error");
    renderStartupFailure(errorText(error, error?.message || "Could not prepare the 49-paper follow-up. Retry later or contact the study coordinator."));
    bindLoginEvents();
  }
}

function bindLoginEvents() {
  if (state.loginEventsBound) return;
  state.loginEventsBound = true;
  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => {
    if (state.pendingRegistration || state.modeSwitchLocked) return;
    state.authMode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-pressed", String(selected));
    });
    $("#recovery-label").classList.toggle("hidden", state.authMode !== "restore");
    $("#recovery-code").classList.toggle("hidden", state.authMode !== "restore");
    $("#recovery-hint").classList.toggle("hidden", state.authMode !== "restore");
    $("#profile-submit").textContent = state.authMode === "restore" ? "Restore profile" : "Create profile";
    setLoginError();
  }));
  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitProfile();
  });
  $("#continue-profile").addEventListener("click", () => void continueCurrentProfile());
  $("#switch-profile").addEventListener("click", () => void switchProfile());
  $("#recovery-ack").addEventListener("change", () => { $("#continue-after-recovery").disabled = !$("#recovery-ack").checked; });
  $("#copy-recovery").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#new-recovery-code").textContent); toast("Recovery code copied."); }
    catch { toast("Copy was unavailable. Select and copy the code manually."); }
  });
  $("#download-recovery").addEventListener("click", downloadRecoveryCode);
  $("#continue-after-recovery").addEventListener("click", () => {
    if (!$("#recovery-ack").checked || !state.pendingRegistration) return;
    const { record, annotatorId } = state.pendingRegistration;
    state.pendingRegistration = null;
    $("#recovery-reveal").classList.add("hidden");
    enterReview(record, annotatorId);
  });
}

async function ensureSession() {
  const result = await state.client.auth.getSession();
  if (result?.error) throw Object.assign(new Error(), { code: "service_unavailable" });
  if (!result?.data?.session) {
    const signIn = await state.client.auth.signInAnonymously();
    if (signIn?.error) throw Object.assign(new Error(), { code: signIn.error.code || "service_unavailable" });
  }
}

async function submitProfile() {
  setLoginError();
  const annotatorId = $("#nickname").value.trim();
  if (!idPattern.test(annotatorId)) { setLoginError("Use 1–64 letters, numbers, underscores, or hyphens. Do not use personal information."); return; }
  const recoveryCode = $("#recovery-code").value.trim();
  if (state.authMode === "restore" && !/^[a-f0-9]{64}$/.test(recoveryCode)) { setLoginError("Enter the 64-character recovery code for this profile."); return; }
  if (!state.config || !state.client) { setLoginError("The private review service is not ready."); return; }
  $("#profile-submit").disabled = true;
  try {
    await ensureSession();
    if (state.authMode === "create") {
      const code = state.pendingRegistration?.annotatorId === annotatorId ? state.pendingRegistration.recoveryCode : randomRecoveryCode();
      state.pendingRegistration = { annotatorId, recoveryCode: code, record: null };
      const payload = await rpc(RPC.register, { p_annotator_id: annotatorId, p_recovery_code: code });
      const record = validateRecordOrThrow(unwrapRecord(payload), annotatorId);
      state.pendingRegistration.record = record;
      state.currentProfile = annotatorId;
      $("#new-nickname").textContent = annotatorId;
      $("#new-recovery-code").textContent = code;
      $("#recovery-ack").checked = false;
      $("#continue-after-recovery").disabled = true;
      $("#profile-actions").classList.add("hidden");
      $("#recovery-reveal").classList.remove("hidden");
    } else {
      const payload = await rpc(RPC.resume, { p_annotator_id: annotatorId, p_recovery_code: recoveryCode });
      const resumed = validateRecordOrThrow(unwrapRecord(payload), annotatorId);
      const loaded = unwrapRecord(await rpc(RPC.load, { p_annotator_id: annotatorId }));
      const record = validateRecordOrThrow(loaded || resumed, annotatorId);
      enterReview(record, annotatorId);
    }
  } catch (error) {
    setLoginError(errorText(error, state.authMode === "create" ? "Could not create the review profile. Retry the same nickname." : "Could not restore the review profile. Check the nickname and recovery code."));
    if (state.authMode === "create" && error?.code !== "name_taken") {
      // Keep the recovery code so a network retry cannot create a different credential.
      if (state.pendingRegistration?.annotatorId !== annotatorId) state.pendingRegistration = null;
    } else if (error?.code === "name_taken") state.pendingRegistration = null;
  } finally {
    $("#profile-submit").disabled = false;
  }
}

async function continueCurrentProfile() {
  $("#continue-profile").disabled = true;
  try {
    const payload = await rpc(RPC.current);
    const record = validateRecordOrThrow(unwrapRecord(payload), state.currentProfile);
    const loaded = unwrapRecord(await rpc(RPC.load, { p_annotator_id: state.currentProfile }));
    enterReview(validateRecordOrThrow(loaded || record, state.currentProfile), state.currentProfile);
  } catch (error) {
    setLoginError(errorText(error, "Could not load the profile on this device. Restore it with the recovery code."));
    $("#continue-profile").disabled = false;
  }
}

async function switchProfile() {
  if (state.dirty || state.saving) {
    try { await saveChanges(); }
    catch {
      if (!confirm("Your latest changes could not be saved. Switch profiles anyway and risk losing them?")) return;
    }
  }
  const result = await state.client.auth.signOut({ scope: "local" });
  if (result?.error) { toast("Could not safely switch profiles. Try again."); return; }
  state.currentProfile = "";
  state.currentProfileRecord = null;
  state.pendingRegistration = null;
  $("#current-profile").classList.add("hidden");
  $("#profile-actions").classList.remove("hidden");
  setLoginError();
}

function downloadRecoveryCode() {
  const code = state.pendingRegistration?.recoveryCode;
  if (!code) return;
  const text = `xACL-Era follow-up profile\nNickname: ${state.pendingRegistration.annotatorId}\nRecovery code: ${code}\n\nKeep this file private. Anyone with both values can access this profile.\n`;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `xacl-followup49-${state.pendingRegistration.annotatorId}-recovery.txt`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function enterReview(record, annotatorId) {
  state.record = structuredClone(record);
  state.annotatorId = annotatorId;
  state.currentProfile = annotatorId;
  state.dirty = false;
  state.saving = false;
  state.editVersion = 0;
  $("#login-screen").classList.add("hidden");
  $("#review-app").classList.remove("hidden");
  $("#active-annotator").textContent = annotatorId;
  const first = state.orderedPapers.find((paper) => state.record.annotations[paper.sample_id]?.status !== "completed") || state.orderedPapers[0];
  state.activeSampleId = "";
  renderPaperList();
  renderProgress();
  setSaveStatus(state.record.revision ? `Saved · revision ${state.record.revision}` : "No saved responses yet", state.record.revision ? "saved" : "");
  if (first) void selectPaper(first.sample_id, { allowUnsaved: true });
}

function renderPaperList() {
  if (!state.manifest) return;
  const root = $("#paper-list");
  root.replaceChildren();
  for (const [index, paper] of state.orderedPapers.entries()) {
    const row = state.record?.annotations?.[paper.sample_id];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `paper-item${paper.sample_id === state.activeSampleId ? " active" : ""}`;
    button.setAttribute("aria-current", paper.sample_id === state.activeSampleId ? "true" : "false");
    const main = document.createElement("span");
    main.className = "paper-item-main";
    const priority = document.createElement("span");
    priority.className = paper.priority === "priority" ? "priority-mini" : "secondary-mini";
    priority.setAttribute("aria-hidden", "true");
    const sampleId = document.createElement("span");
    sampleId.textContent = paper.sample_id;
    const status = document.createElement("span");
    status.className = `paper-item-state${row?.status === "completed" ? " completed" : row?.status === "draft" ? " draft" : ""}`;
    status.textContent = row?.status === "completed" ? "Complete" : row?.status === "draft" ? "Draft" : "Not started";
    main.append(priority, sampleId, status);
    const title = document.createElement("span");
    title.className = "paper-item-meta";
    title.textContent = paper.title;
    button.append(main, title);
    button.setAttribute("aria-label", `${index + 1} of 49, ${paper.sample_id}, ${paper.title}, ${status.textContent}`);
    button.addEventListener("click", () => void selectPaper(paper.sample_id));
    root.append(button);
  }
}

function renderProgress() {
  if (!state.manifest || !state.record) return;
  const completed = Object.values(state.record.annotations).filter((row) => row.status === "completed").length;
  $("#progress-count").textContent = `${completed} / ${state.orderedPapers.length}`;
  $(".progress-track").setAttribute("aria-valuemax", String(state.orderedPapers.length));
  $(".progress-track").setAttribute("aria-valuenow", String(completed));
  $("#progress-fill").style.width = `${completed / state.orderedPapers.length * 100}%`;
}

function renderGuidance() {
  const list = $("#guidance-list");
  list.replaceChildren();
  for (const instruction of state.guidance.instructions) {
    const item = document.createElement("li");
    item.textContent = instruction;
    list.append(item);
  }
  $("#scope-note").textContent = state.guidance.scope_note;
}

function ensureRow(paper) {
  let row = state.record.annotations[paper.sample_id];
  if (!row) {
    row = { status: "draft", updated_at: new Date().toISOString(), findings: {} };
    state.record.annotations[paper.sample_id] = row;
  }
  return row;
}

function renderIssues(paper) {
  const root = $("#issue-list");
  root.replaceChildren();
  const row = state.record.annotations[paper.sample_id];
  $("#issue-count").textContent = `${paper.issues.length} flagged ${paper.issues.length === 1 ? "issue" : "issues"}`;
  for (const issue of paper.issues) {
    const finding = row?.findings?.[issue.id] || null;
    const card = document.createElement("article");
    card.className = "issue-card";
    const header = document.createElement("div");
    header.className = "issue-title";
    const heading = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = ISSUE_LABELS[issue.id];
    const intro = document.createElement("p");
    intro.textContent = "Review this model-flagged concern against the paper. The flag is not a confirmed defect.";
    heading.append(title, intro);
    header.append(heading);

    const fields = document.createElement("div");
    fields.className = "issue-fields";
    const verdictField = makeField("Verdict", "select");
    verdictField.control.dataset.findingField = "verdict";
    const verdictPlaceholder = new Option("Choose a verdict", "");
    verdictField.control.add(verdictPlaceholder);
    for (const verdict of FOLLOWUP_VERDICTS) verdictField.control.add(new Option(VERDICT_LABELS[verdict], verdict));
    verdictField.control.value = finding?.verdict || "";
    verdictField.control.dataset.issueId = issue.id;

    const categoryField = makeField("Issue category (optional)", "select");
    categoryField.control.dataset.findingField = "category";
    categoryField.control.dataset.issueId = issue.id;
    categoryField.control.add(new Option("No category", ""));
    for (const category of FOLLOWUP_CATEGORIES) categoryField.control.add(new Option(CATEGORY_LABELS[category], category));
    categoryField.control.value = finding?.category || "";
    categoryField.control.disabled = !finding;

    const noteField = makeField("Note / page evidence (optional)", "textarea");
    noteField.control.maxLength = 2000;
    noteField.control.placeholder = "Add a concise explanation or physical page number, if useful.";
    noteField.control.value = finding?.note || "";
    noteField.control.dataset.findingField = "note";
    noteField.control.dataset.issueId = issue.id;
    noteField.control.disabled = !finding;
    fields.append(verdictField.wrap, categoryField.wrap, noteField.wrap);
    card.append(header, fields);
    const evidence = state.evidence?.papers?.[paper.sample_id]?.[issue.id];
    const details = document.createElement("details");
    details.className = "evidence";
    const summary = document.createElement("summary");
    summary.textContent = "Show model observations (optional)";
    details.append(summary);
    if (evidence) {
      const grid = document.createElement("div");
      grid.className = "evidence-grid";
      for (const [label, value] of [["GPT observation", evidence.gpt_reason], ["Gemini observation", evidence.gemini_reason], ["Scope note", evidence.scope_note]]) {
        if (!value) continue;
        const evidenceCard = document.createElement("div");
        evidenceCard.className = "evidence-card";
        const name = document.createElement("strong");
        name.textContent = label;
        const body = document.createElement("p");
        body.textContent = value;
        evidenceCard.append(name, body);
        grid.append(evidenceCard);
      }
      details.append(grid);
    } else {
      const unavailable = document.createElement("p");
      unavailable.className = "hint";
      unavailable.textContent = "Model observations are not loaded from a verified private evidence file.";
      details.append(unavailable);
    }
    card.append(details);
    root.append(card);
  }
  root.querySelectorAll("[data-finding-field]").forEach((control) => {
    const eventType = control.dataset.findingField === "note" ? "input" : "change";
    control.addEventListener(eventType, () => updateFinding(control, paper));
  });
}

function makeField(labelText, controlName) {
  const wrap = document.createElement("div");
  wrap.className = "field-group";
  const label = document.createElement("label");
  label.textContent = labelText;
  const control = document.createElement(controlName);
  controlName === "select" ? control.classList.add("finding-select") : control.classList.add("finding-note");
  label.append(document.createTextNode(" "));
  const id = `field-${Math.random().toString(36).slice(2)}`;
  control.id = id;
  label.htmlFor = id;
  wrap.append(label, control);
  return { wrap, control };
}

function updateFinding(control, paper) {
  const issueId = control.dataset.issueId;
  const field = control.dataset.findingField;
  const row = ensureRow(paper);
  const current = row.findings[issueId] || null;
  if (field === "verdict") {
    const value = control.value;
    if (!value) delete row.findings[issueId];
    else row.findings[issueId] = { verdict: value, category: current?.category ?? null, note: current?.note || "" };
    const card = control.closest(".issue-card");
    card.querySelector('[data-finding-field="category"]').disabled = !value;
    card.querySelector('[data-finding-field="note"]').disabled = !value;
    if (!value) {
      card.querySelector('[data-finding-field="category"]').value = "";
      card.querySelector('[data-finding-field="note"]').value = "";
    }
  } else if (current) {
    if (field === "category") current.category = control.value || null;
    if (field === "note") current.note = control.value;
  }
  row.status = "draft";
  row.updated_at = new Date().toISOString();
  markDirty();
  renderPaperList();
  updateCompletionState(paper);
}

function markDirty() {
  state.dirty = true;
  state.editVersion += 1;
  setSaveStatus("Unsaved changes", "dirty");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => { void saveChanges().catch(() => {}); }, 900);
}

function findingComplete(paper) {
  const findings = state.record.annotations[paper.sample_id]?.findings || {};
  return paper.issues.every((issue) => {
    const finding = findings[issue.id];
    return finding && FOLLOWUP_VERDICTS.includes(finding.verdict) &&
      (finding.category === null || FOLLOWUP_CATEGORIES.includes(finding.category)) &&
      typeof finding.note === "string" && [...finding.note].length <= 2000;
  });
}

function updateCompletionState(paper) {
  const row = state.record.annotations[paper.sample_id];
  const checked = $("#inspection-ack").checked;
  const verified = state.verifiedThisSession.has(paper.sample_id) && state.pdfLoadReady;
  const eligible = verified && checked && findingComplete(paper);
  const button = $("#complete-paper");
  button.textContent = row?.status === "completed" ? "Reopen paper" : "Mark paper complete";
  button.classList.toggle("primary", row?.status !== "completed");
  button.disabled = row?.status !== "completed" && !eligible;
  const help = $("#completion-help");
  if (row?.status === "completed") help.textContent = "This review is complete. Reopen it to make changes; an edit will save as a draft until the checks are complete again.";
  else if (!verified || !checked) help.textContent = "Verify, open, and inspect the matching PDF during this session. Partial responses can be saved as a draft.";
  else if (!findingComplete(paper)) help.textContent = "Choose a verdict for every listed issue. Partial responses can be saved as a draft.";
  else help.textContent = "All flagged issues have a verdict and the matching PDF was inspected during this session.";
}

async function selectPaper(sampleId, { allowUnsaved = false } = {}) {
  if (sampleId === state.activeSampleId) return;
  if (!allowUnsaved && (state.dirty || state.saving)) {
    try { await saveChanges(); }
    catch {
      if (!confirm("These changes could not be saved. Leave this paper and risk losing them?")) return;
    }
  }
  const paper = state.orderedPapers.find((item) => item.sample_id === sampleId);
  if (!paper) return;
  state.pdfRequestSerial += 1;
  state.activeSampleId = sampleId;
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = "";
  state.pdfLoadReady = false;
  $("#pdf-frame").classList.add("hidden");
  $("#pdf-frame").removeAttribute("src");
  $("#pdf-placeholder").classList.remove("hidden");
  $("#pdf-placeholder").textContent = "Verify and open the exact PDF from your private local folder.";
  $("#pdf-actions").classList.add("hidden");
  $("#verify-open-pdf").disabled = !state.fileIndexFiles;
  $("#inspection-ack-label").classList.add("hidden");
  $("#inspection-ack").checked = false;
  const index = state.orderedPapers.findIndex((item) => item.sample_id === sampleId);
  $("#active-counter").textContent = `${index + 1} of ${state.orderedPapers.length}`;
  $("#bottom-counter").textContent = `${index + 1} of ${state.orderedPapers.length}`;
  $("#paper-id").textContent = paper.paper_id;
  $("#paper-title").textContent = paper.title;
  $("#version-tag").textContent = paper.selected_vN;
  $("#priority-tag").textContent = paper.priority === "priority" ? "Priority" : "Secondary";
  $("#priority-tag").classList.toggle("secondary", paper.priority !== "priority");
  $("#paper-meta").textContent = `${paper.total_pdf_pages} physical PDF pages · Assigned review pages: ${paper.assigned_physical_pages.join(", ")}`;
  $("#pdf-page").max = String(paper.total_pdf_pages);
  $("#pdf-page").value = String(paper.assigned_physical_pages[0] || 1);
  setPdfStatusForPaper(paper);
  renderGuidance();
  renderIssues(paper);
  renderPaperList();
  updateCompletionState(paper);
  $("#paper-panel").classList.remove("hidden");
  $("#no-paper").classList.add("hidden");
  const prevDisabled = index === 0;
  const nextDisabled = index === state.orderedPapers.length - 1;
  for (const id of ["previous-paper", "previous-bottom"]) $("#" + id).disabled = prevDisabled;
  for (const id of ["next-paper", "next-bottom"]) $("#" + id).disabled = nextDisabled;
  $("#inspection-ack").onchange = () => updateCompletionState(paper);
  $("#complete-paper").onclick = () => void toggleComplete(paper);
  $("#jump-page").onclick = () => jumpToPage(paper);
  $("#previous-paper").onclick = $("#previous-bottom").onclick = () => {
    if (index > 0) void selectPaper(state.orderedPapers[index - 1].sample_id);
  };
  $("#next-paper").onclick = $("#next-bottom").onclick = () => {
    if (index < state.orderedPapers.length - 1) void selectPaper(state.orderedPapers[index + 1].sample_id);
  };
}

function setPdfStatusForPaper(paper) {
  const status = $("#pdf-status");
  const match = findBundleFiles(state.fileIndexFiles || [], paper.compiled_pdf.file);
  $("#verify-open-pdf").disabled = !state.fileIndexFiles || match.count !== 1 || state.pdfLoadReady;
  if (!state.fileIndexFiles) {
    status.textContent = "Choose the private local review folder.";
    status.dataset.state = "";
  } else if (match.count === 0) {
    status.textContent = `Missing ${paper.compiled_pdf.file} in the selected folder.`;
    status.dataset.state = "error";
  } else if (match.count > 1) {
    status.textContent = `More than one file matches ${paper.compiled_pdf.file}; the bundle is ambiguous.`;
    status.dataset.state = "error";
  } else if (state.verifiedThisSession.has(paper.sample_id)) {
    status.textContent = "Exact PDF verified and opened during this session.";
    status.dataset.state = "ready";
  } else {
    status.textContent = `${paper.compiled_pdf.file} is available. Verify its bytes before reviewing.`;
    status.dataset.state = "";
  }
}

async function verifyAndOpenPdf() {
  const paper = state.orderedPapers.find((item) => item.sample_id === state.activeSampleId);
  if (!paper || !state.fileIndexFiles) { toast("Choose the private local review folder first."); return; }
  const result = findBundleFiles(state.fileIndexFiles, paper.compiled_pdf.file);
  if (result.count !== 1 || !result.file) { setPdfStatusForPaper(paper); return; }
  const sampleId = paper.sample_id;
  const bundleGeneration = state.bundleGeneration;
  const requestSerial = ++state.pdfRequestSerial;
  const status = $("#pdf-status");
  status.textContent = "Checking file size and SHA-256 locally…";
  status.dataset.state = "";
  try {
    if (result.file.size !== paper.compiled_pdf.bytes) throw new Error("File size does not match the frozen PDF.");
    const digest = await sha256Hex(await result.file.arrayBuffer());
    if (state.activeSampleId !== sampleId || state.bundleGeneration !== bundleGeneration || state.pdfRequestSerial !== requestSerial) return;
    if (digest !== paper.compiled_pdf.sha256) throw new Error("File checksum does not match the frozen PDF.");
    if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
    state.pdfUrl = URL.createObjectURL(result.file);
    state.pdfLoadReady = false;
    const frame = $("#pdf-frame");
    frame.onload = () => {
      if (state.activeSampleId !== sampleId || state.bundleGeneration !== bundleGeneration || state.pdfRequestSerial !== requestSerial) return;
      state.pdfLoadReady = true;
      state.verifiedThisSession.add(paper.sample_id);
      setPdfStatusForPaper(paper);
      $("#inspection-ack-label").classList.remove("hidden");
      updateCompletionState(paper);
    };
    frame.onerror = () => {
      if (state.activeSampleId !== sampleId || state.bundleGeneration !== bundleGeneration || state.pdfRequestSerial !== requestSerial) return;
      status.textContent = "The browser could not open this PDF. Try the new-tab link or another PDF-capable browser.";
      status.dataset.state = "error";
    };
    frame.src = `${state.pdfUrl}#page=${paper.assigned_physical_pages[0] || 1}`;
    frame.classList.remove("hidden");
    $("#pdf-placeholder").classList.add("hidden");
    $("#pdf-actions").classList.remove("hidden");
    $("#open-pdf-tab").href = state.pdfUrl;
    status.textContent = "Checksum matched. Opening local PDF…";
    $("#verify-open-pdf").disabled = true;
    $("#inspection-ack-label").classList.remove("hidden");
  } catch (error) {
    if (state.activeSampleId !== sampleId || state.bundleGeneration !== bundleGeneration || state.pdfRequestSerial !== requestSerial) return;
    status.textContent = error?.message || "The local PDF could not be verified.";
    status.dataset.state = "error";
    state.verifiedThisSession.delete(paper.sample_id);
    state.pdfLoadReady = false;
  }
}

function jumpToPage(paper) {
  const page = Number($("#pdf-page").value);
  if (!Number.isInteger(page) || page < 1 || page > paper.total_pdf_pages || !state.pdfUrl) {
    toast(`Enter a physical page from 1 to ${paper.total_pdf_pages}.`);
    return;
  }
  $("#pdf-frame").src = `${state.pdfUrl}#page=${page}`;
}

function makeBundleIndex(fileList) {
  state.bundleGeneration += 1;
  state.pdfRequestSerial += 1;
  const entries = [...fileList];
  state.fileIndexFiles = entries;
  state.fileIndex = new Map();
  for (const file of entries) {
    const path = normalizeBundlePath(file);
    if (!path) continue;
    if (!state.fileIndex.has(path)) state.fileIndex.set(path, []);
    state.fileIndex.get(path).push(file);
  }
  state.verifiedThisSession.clear();
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = "";
  state.pdfLoadReady = false;
  $("#pdf-frame").classList.add("hidden");
  $("#pdf-frame").removeAttribute("src");
  $("#pdf-placeholder").classList.remove("hidden");
  $("#inspection-ack-label").classList.add("hidden");
  $("#inspection-ack").checked = false;
  $("#verify-open-pdf").disabled = !state.activeSampleId;
}

async function loadPrivateBundle(fileList) {
  const files = [...fileList];
  makeBundleIndex(files);
  const status = $("#bundle-status");
  const evidenceMatches = files.filter((file) => normalizeBundlePath(file) === "review-evidence.json");
  state.evidence = null;
  let evidenceMessage = "Model observations are not available; PDF-based review is still possible.";
  if (evidenceMatches.length === 1) {
    try {
      const file = evidenceMatches[0];
      const bytes = await file.arrayBuffer();
      if (await sha256Hex(bytes) !== state.config.evidence_sha256) throw new Error("The private review-evidence checksum does not match this dataset.");
      const parsed = JSON.parse(new TextDecoder().decode(bytes));
      state.evidence = validateFollowupEvidence(parsed, state.manifest);
      evidenceMessage = "Private model observations verified locally.";
    } catch (error) {
      evidenceMessage = error?.message || "Private review evidence could not be verified.";
    }
  } else if (evidenceMatches.length > 1) evidenceMessage = "More than one review-evidence.json file was found; model observations are disabled.";

  const availableCount = state.manifest.papers.filter((paper) => findBundleFiles(files, paper.compiled_pdf.file).count === 1).length;
  const duplicateCount = state.manifest.papers.filter((paper) => findBundleFiles(files, paper.compiled_pdf.file).count > 1).length;
  status.textContent = `${availableCount}/49 PDFs found. ${evidenceMessage}`;
  status.dataset.state = availableCount === 49 && state.evidence ? "ready" : "";
  $("#bundle-input").value = "";
  if (state.activeSampleId) {
    const paper = state.orderedPapers.find((item) => item.sample_id === state.activeSampleId);
    setPdfStatusForPaper(paper);
    renderIssues(paper);
    updateCompletionState(paper);
  }
  if (availableCount !== 49 || duplicateCount) {
    const details = duplicateCount ? ` ${duplicateCount} ambiguous file match${duplicateCount === 1 ? "" : "es"}.` : "";
    status.textContent += details;
  }
}

async function saveChanges() {
  clearTimeout(state.saveTimer);
  if (!state.record || !state.annotatorId || (!state.dirty && !state.saving)) return;
  if (state.savePromise) return state.savePromise;
  state.savePromise = (async () => {
    state.saving = true;
    setSaveStatus("Saving…", "saving");
    try {
      do {
        const version = state.editVersion;
        const snapshot = structuredClone(state.record);
        const payload = await rpc(RPC.save, {
          p_annotator_id: state.annotatorId,
          p_record: snapshot,
          p_guidance_version: state.config.guidance_version,
          p_guidance_sha256: state.config.guidance_sha256,
          p_operation: "save",
        });
        const saved = validateRecordOrThrow(unwrapRecord(payload), state.annotatorId);
        if (saved.revision <= snapshot.revision) throw Object.assign(new Error(), { code: "service_unavailable" });
        state.record.revision = saved.revision;
        state.record.created_at = saved.created_at;
        state.record.updated_at = saved.updated_at;
        state.dirty = state.editVersion !== version;
        if (state.dirty) setSaveStatus("Saving newer edits…", "saving");
      } while (state.dirty);
      setSaveStatus(`Saved · revision ${state.record.revision}`, "saved");
      renderProgress();
      renderPaperList();
      return state.record;
    } catch (error) {
      state.dirty = true;
      setSaveStatus(error?.code === "revision_conflict" ? "Conflict · local edits kept" : "Save failed · local edits kept", "error");
      throw error;
    } finally {
      state.saving = false;
      state.savePromise = null;
    }
  })();
  return state.savePromise;
}

async function toggleComplete(paper) {
  const row = state.record.annotations[paper.sample_id];
  if (row?.status === "completed") {
    row.status = "draft";
    row.updated_at = new Date().toISOString();
    markDirty();
    updateCompletionState(paper);
    await saveChanges().catch(() => {});
    toast("Paper reopened as a draft.");
    return;
  }
  if (!state.verifiedThisSession.has(paper.sample_id) || !state.pdfLoadReady || !$("#inspection-ack").checked) {
    toast("Verify, open, and inspect the matching PDF before completing this paper.");
    return;
  }
  if (!findingComplete(paper)) {
    toast("Choose a verdict for every flagged issue before completing this paper.");
    return;
  }
  const annotation = ensureRow(paper);
  annotation.status = "completed";
  annotation.updated_at = new Date().toISOString();
  markDirty();
  updateCompletionState(paper);
  try {
    await saveChanges();
    toast("Paper review saved as complete.");
    const next = state.orderedPapers.find((item) => state.record.annotations[item.sample_id]?.status !== "completed");
    if (next && next.sample_id !== paper.sample_id) await selectPaper(next.sample_id);
  } catch {
    annotation.status = "draft";
    annotation.updated_at = new Date().toISOString();
    state.dirty = true;
    updateCompletionState(paper);
    toast("Completion was not saved. Your responses remain as a draft in this browser.");
  }
}

function bindReviewEvents() {
  $("#bundle-input").addEventListener("change", (event) => {
    if (event.target.files?.length) void loadPrivateBundle(event.target.files);
  });
  $("#save-now").addEventListener("click", () => void saveChanges().then(() => toast("All changes are saved.")).catch((error) => toast(errorText(error, "Save failed. Your edits remain in this browser."))));
  $("#switch-annotator").addEventListener("click", () => void switchProfileFromReview());
  $("#verify-open-pdf").addEventListener("click", () => void verifyAndOpenPdf());
  $("#inspection-ack").addEventListener("change", () => {
    const paper = state.orderedPapers.find((item) => item.sample_id === state.activeSampleId);
    if (paper) updateCompletionState(paper);
  });
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty || state.saving) { event.preventDefault(); event.returnValue = ""; }
  });
}

async function switchProfileFromReview() {
  if (state.dirty || state.saving) {
    try { await saveChanges(); }
    catch {
      if (!confirm("Your latest changes could not be saved. Switch profiles anyway and risk losing them?")) return;
    }
  }
  const result = await state.client.auth.signOut({ scope: "local" });
  if (result?.error) { toast("Could not safely switch profiles. Try again."); return; }
  state.record = null;
  state.annotatorId = "";
  state.activeSampleId = "";
  state.dirty = false;
  $("#review-app").classList.add("hidden");
  $("#login-screen").classList.remove("hidden");
  $("#current-profile").classList.add("hidden");
  $("#profile-actions").classList.remove("hidden");
  state.pendingRegistration = null;
  setLoginError();
}

function bindReviewStartupEvents() {
  if (state.reviewEventsBound) return;
  state.reviewEventsBound = true;
  bindReviewEvents();
}

if (typeof document !== "undefined") {
  const boot = () => { void initialize().then(() => bindReviewStartupEvents()); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
