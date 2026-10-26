import { QUALITY_PROTOCOL_ID, QUALITY_RECORD_SCHEMA, qualityRecordIssue } from "./quality-protocol.mjs";
import {
  VERSION_DIFFERENCE_KEYS as WRITING_VERSION_DIFFERENCE_KEYS,
  VISUAL_ISSUE_KEYS,
  WRITING_PROTOCOL_ID,
  WRITING_RECORD_SCHEMA,
  WRITING_SCORE_KEYS,
  writingRecordIssue,
} from "./writing-protocol.mjs";

const SITE_BASE_URL = new URL("./", import.meta.url);
const LEGACY_CONFIG_SCHEMA = "xacl.hosted-config.v1";
const QUALITY_CONFIG_SCHEMA = "xacl.hosted-config.v2";
const WRITING_CONFIG_SCHEMA = "xacl.hosted-config.v3";
const MANIFEST_SCHEMA = "revisionlens.alignment30.manifest.v1";
const LEGACY_RUBRIC_SCHEMA = "revisionlens.alignment-rubric.v1";
const QUALITY_RUBRIC_SCHEMA = "xacl.document-quality-rubric.v1";
const WRITING_RUBRIC_SCHEMA = "xacl.latex-writing-quality-rubric.v1";
const LEGACY_GUIDANCE_SCHEMA = "revisionlens.alignment-guidance.v1";
const QUALITY_GUIDANCE_SCHEMA = "xacl.document-quality-guidance.v1";
const WRITING_GUIDANCE_SCHEMA = "xacl.latex-writing-quality-guidance.v1";
const LEGACY_RECORD_SCHEMA = "revisionlens.alignment-annotations.v1";
const AUTH_MODE = "anonymous_recovery_v1";
const LEGACY_RPC_NAMES = Object.freeze({
  health: "xacl_annotation_health",
  register: "xacl_register_annotator",
  resume: "xacl_resume_annotator",
  current: "xacl_current_annotations",
  load: "xacl_load_annotations",
  save: "xacl_save_annotations",
});
const QUALITY_RPC_NAMES = Object.freeze({
  health: "xacl_quality_annotation_health",
  register: "xacl_quality_register_annotator",
  resume: "xacl_quality_resume_annotator",
  current: "xacl_quality_current_annotations",
  load: "xacl_quality_load_annotations",
  save: "xacl_quality_save_annotations",
});
const WRITING_RPC_NAMES = Object.freeze({
  health: "xacl_writing_annotation_health",
  register: "xacl_writing_register_annotator",
  resume: "xacl_writing_resume_annotator",
  current: "xacl_writing_current_annotations",
  load: "xacl_writing_load_annotations",
  save: "xacl_writing_save_annotations",
});
const RPC_NAMES = new Set([
  ...Object.values(LEGACY_RPC_NAMES),
  ...Object.values(QUALITY_RPC_NAMES),
  ...Object.values(WRITING_RPC_NAMES),
]);

export class HostedAdapterError extends Error {
  constructor(code, status = 0, currentRevision = null) {
    super(code);
    this.name = "HostedAdapterError";
    this.code = code;
    this.status = status;
    this.currentRevision = Number.isInteger(currentRevision) ? currentRevision : null;
  }
}

function fail(code, status = 0, currentRevision = null) {
  throw new HostedAdapterError(code, status, currentRevision);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function hasExactlyKeys(value, expected) {
  return isPlainObject(value) && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isQualityConfig(config) {
  return config.schema === QUALITY_CONFIG_SCHEMA;
}

function isWritingConfig(config) {
  return config.schema === WRITING_CONFIG_SCHEMA;
}

function isProtocolConfig(config) {
  return isQualityConfig(config) || isWritingConfig(config);
}

function parseJsonBytes(bytes) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function readStaticJson(name, baseUrl, fetchImpl) {
  const safeName = typeof name === "string" ? name : "";
  const label = safeName.split("/").at(-1).replace(/\.json$/i, "").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  const segments = safeName ? safeName.split("/") : [];
  if (!segments.length || segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) || segment === ".." || segment === ".")) {
    fail(`${label || "asset"}_invalid`);
  }
  const url = new URL(safeName, baseUrl);
  const basePath = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(basePath)) fail(`${label}_invalid`);
  let response;
  try {
    response = await fetchImpl(url.href, { cache: "no-store", credentials: "same-origin" });
  } catch {
    fail(`${label}_unavailable`);
  }
  if (!response?.ok) fail(`${label}_unavailable`, response?.status || 0);
  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    fail(`${label}_invalid`);
  }
  try { return { bytes, value: parseJsonBytes(bytes) }; } catch { fail(`${label}_invalid`); }
}

export async function sha256Hex(bytes, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle?.digest) fail("crypto_unavailable");
  const digest = await cryptoProvider.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function validateConfig(config) {
  const legacyConfigKeys = [
    "schema", "supabase_url", "supabase_publishable_key", "study_id", "manifest_sha256",
    "guidance_version", "guidance_sha256", "auth_mode",
  ];
  const qualityConfigKeys = [
    ...legacyConfigKeys,
    "protocol_id", "record_schema", "rubric_version", "rubric_path", "rubric_sha256",
    "guidance_path", "sample_rubric_version",
  ];
  const schemaValid = isPlainObject(config) && (
    (config.schema === LEGACY_CONFIG_SCHEMA && hasExactlyKeys(config, legacyConfigKeys)) ||
    (config.schema === QUALITY_CONFIG_SCHEMA && hasExactlyKeys(config, qualityConfigKeys) &&
      config.protocol_id === QUALITY_PROTOCOL_ID && config.record_schema === QUALITY_RECORD_SCHEMA &&
      config.rubric_version === "document-quality-rubric-v1" &&
      config.rubric_path === "protocols/document-quality-v1/rubric.json" &&
      validSha256(config.rubric_sha256) &&
      config.guidance_path === "protocols/document-quality-v1/guidance.json" &&
      config.sample_rubric_version === "alignment-rubric-v1") ||
    (config.schema === WRITING_CONFIG_SCHEMA && hasExactlyKeys(config, qualityConfigKeys) &&
      config.protocol_id === WRITING_PROTOCOL_ID && config.record_schema === WRITING_RECORD_SCHEMA &&
      config.rubric_version === "latex-writing-quality-rubric-v1" &&
      config.rubric_path === "protocols/latex-writing-quality-v1/rubric.json" &&
      validSha256(config.rubric_sha256) &&
      config.guidance_path === "protocols/latex-writing-quality-v1/guidance.json" &&
      config.sample_rubric_version === "alignment-rubric-v1")
  );
  if (!schemaValid || typeof config.study_id !== "string" || !config.study_id ||
      !validSha256(config.manifest_sha256) || !validSha256(config.guidance_sha256) ||
      typeof config.guidance_version !== "string" || !config.guidance_version ||
      config.auth_mode !== AUTH_MODE ||
      typeof config.supabase_publishable_key !== "string" || !config.supabase_publishable_key.startsWith("sb_publishable_") ||
      !config.supabase_url) fail("static_package_invalid");

  let serviceUrl;
  try { serviceUrl = new URL(config.supabase_url); } catch { fail("static_package_invalid"); }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(serviceUrl.hostname);
  if ((serviceUrl.protocol !== "https:" && !(serviceUrl.protocol === "http:" && isLoopback)) ||
      serviceUrl.username || serviceUrl.password || serviceUrl.search || serviceUrl.hash ||
      (serviceUrl.pathname !== "/" && serviceUrl.pathname !== "")) fail("static_package_invalid");

  return {
    ...config,
    supabase_url: serviceUrl.origin,
    manifest_sha256: config.manifest_sha256.toLowerCase(),
    guidance_sha256: config.guidance_sha256.toLowerCase(),
    ...(isProtocolConfig(config) ? { rubric_sha256: config.rubric_sha256.toLowerCase() } : {}),
  };
}

function validateManifest(manifest, config, rubric) {
  const sampleRubricVersion = isProtocolConfig(config) ? config.sample_rubric_version : rubric.version;
  if (!isPlainObject(manifest) || manifest.schema !== MANIFEST_SCHEMA ||
      manifest.dataset_id !== config.study_id || manifest.rubric_version !== sampleRubricVersion ||
      !Array.isArray(manifest.papers) || manifest.papers.length !== 30) fail("manifest_invalid");
  const seen = new Set();
  for (const paper of manifest.papers) {
    if (!isPlainObject(paper) || typeof paper.sample_id !== "string" || !paper.sample_id || seen.has(paper.sample_id) ||
        !isPlainObject(paper.compiled_pdf) || !isPlainObject(paper.official_pdf) ||
        typeof paper.compiled_pdf.path !== "string" || typeof paper.official_pdf.path !== "string") fail("manifest_invalid");
    seen.add(paper.sample_id);
  }
}

function validateRubric(rubric, manifest, config) {
  if (isWritingConfig(config)) {
    const bilingual = (value) => isPlainObject(value) && typeof value.en === "string" && value.en.trim() &&
      typeof value.zh === "string" && value.zh.trim();
    const scoreLevels = ["1", "2", "3", "4", "5"];
    const validFlags = (flags, expectedKeys) => Array.isArray(flags) && flags.length === expectedKeys.length &&
      flags.every((flag, index) => hasExactlyKeys(flag, ["key", "label", "label_zh"]) &&
        flag.key === expectedKeys[index] && typeof flag.label === "string" && flag.label.trim() &&
        typeof flag.label_zh === "string" && flag.label_zh.trim());
    const dimensionsValid = Array.isArray(rubric?.dimensions) && rubric.dimensions.length === WRITING_SCORE_KEYS.length &&
      rubric.dimensions.every((dimension, index) =>
        hasExactlyKeys(dimension, ["key", "label", "definition", "allows_na", "scale", "label_zh", "definition_zh", "scale_zh"]) &&
        dimension.key === WRITING_SCORE_KEYS[index] && dimension.allows_na === false &&
        ["label", "definition", "label_zh", "definition_zh"].every((key) => typeof dimension[key] === "string" && dimension[key].trim()) &&
        hasExactlyKeys(dimension.scale, scoreLevels) && scoreLevels.every((level) => typeof dimension.scale[level] === "string" && dimension.scale[level].trim()) &&
        hasExactlyKeys(dimension.scale_zh, scoreLevels) && scoreLevels.every((level) => typeof dimension.scale_zh[level] === "string" && dimension.scale_zh[level].trim()));
    const auxiliary = rubric?.auxiliary_pdf_visual_integrity;
    const auxiliaryValid = isPlainObject(auxiliary) && auxiliary.included_in_core_scores === false &&
      auxiliary.unobserved === "not_assessed" && auxiliary.unassessable === "uncertain" &&
      ["label", "label_zh", "definition", "definition_zh"].every((key) =>
        typeof auxiliary[key] === "string" && auxiliary[key].trim()) &&
      hasExactlyKeys(auxiliary.scale, scoreLevels) &&
      scoreLevels.every((level) => typeof auxiliary.scale[level] === "string" && auxiliary.scale[level].trim()) &&
      hasExactlyKeys(auxiliary.scale_zh, scoreLevels) &&
      scoreLevels.every((level) => typeof auxiliary.scale_zh[level] === "string" && auxiliary.scale_zh[level].trim());
    if (!isPlainObject(rubric) || rubric.schema !== WRITING_RUBRIC_SCHEMA ||
        rubric.protocol_id !== WRITING_PROTOCOL_ID || rubric.version !== config.rubric_version ||
        !bilingual(rubric.title) || !bilingual(rubric.scope) || !dimensionsValid || !auxiliaryValid ||
        !validFlags(rubric.version_difference_flags, WRITING_VERSION_DIFFERENCE_KEYS) ||
        !validFlags(rubric.visual_issue_flags, VISUAL_ISSUE_KEYS)) fail("rubric_invalid");
    return;
  }
  if (isQualityConfig(config)) {
    if (!isPlainObject(rubric) || rubric.schema !== QUALITY_RUBRIC_SCHEMA ||
        rubric.protocol_id !== QUALITY_PROTOCOL_ID || rubric.version !== config.rubric_version ||
        !Array.isArray(rubric.dimensions) || !Array.isArray(rubric.version_difference_flags)) fail("rubric_invalid");
    return;
  }
  if (!isPlainObject(rubric) || rubric.schema !== LEGACY_RUBRIC_SCHEMA || rubric.version !== manifest.rubric_version ||
      !Array.isArray(rubric.dimensions) || !Array.isArray(rubric.flags)) fail("rubric_invalid");
}

function validateGuidance(guidance, config) {
  const quality = isProtocolConfig(config);
  const schema = isWritingConfig(config) ? WRITING_GUIDANCE_SCHEMA :
    quality ? QUALITY_GUIDANCE_SCHEMA : LEGACY_GUIDANCE_SCHEMA;
  const protocolId = quality ? config.protocol_id : null;
  const bilingual = (value) => isPlainObject(value) && typeof value.en === "string" && value.en.trim() &&
    typeof value.zh === "string" && value.zh.trim();
  if (!isPlainObject(guidance) || guidance.schema !== schema ||
      (quality && guidance.protocol_id !== protocolId) || guidance.version !== config.guidance_version ||
      !bilingual(guidance.title) || !bilingual(guidance.scope) || !Array.isArray(guidance.quick_rules) ||
      guidance.quick_rules.length < 1 || guidance.quick_rules.length > 4 || !guidance.quick_rules.every(bilingual) ||
      !bilingual(guidance.publication_notice?.title) || !bilingual(guidance.publication_notice?.text) ||
      !bilingual(guidance.details_title) || !Array.isArray(guidance.details) || guidance.details.length < 1 ||
      guidance.details.length > 8 || !guidance.details.every((item) => bilingual(item?.title) && bilingual(item?.text))) {
    fail("guidance_invalid");
  }
}

export async function loadHostedAssets({
  fetchImpl = globalThis.fetch,
  baseUrl = SITE_BASE_URL,
  cryptoProvider = globalThis.crypto,
} = {}) {
  if (typeof fetchImpl !== "function") fail("static_package_unavailable");
  const siteBase = new URL(baseUrl);
  const [configFile] = await Promise.all([readStaticJson("config.json", siteBase, fetchImpl)]);
  const config = validateConfig(configFile.value);
  const protocolConfig = isProtocolConfig(config);
  const [manifestFile, rubricFile, guidanceFile] = await Promise.all([
    readStaticJson("manifest.json", siteBase, fetchImpl),
    readStaticJson(protocolConfig ? config.rubric_path : "rubric.json", siteBase, fetchImpl),
    readStaticJson(protocolConfig ? config.guidance_path : "guidance.json", siteBase, fetchImpl),
  ]);
  const [manifestHash, rubricHash, guidanceHash] = await Promise.all([
    sha256Hex(manifestFile.bytes, cryptoProvider),
    sha256Hex(rubricFile.bytes, cryptoProvider),
    sha256Hex(guidanceFile.bytes, cryptoProvider),
  ]);
  if (manifestHash !== config.manifest_sha256 || guidanceHash !== config.guidance_sha256 ||
      (protocolConfig && rubricHash !== config.rubric_sha256)) fail("static_hash_mismatch");
  const rubric = rubricFile.value;
  const manifest = manifestFile.value;
  const guidance = guidanceFile.value;
  validateRubric(rubric, manifest, config);
  validateManifest(manifest, config, rubric);
  validateGuidance(guidance, config);
  return Object.freeze({ config, manifest, rubric, guidance, manifestHash, rubricHash, guidanceHash });
}

function errorCode(payload) {
  const raw = payload?.error ?? payload?.code;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

function safeRpcFailure(name, status, payload) {
  const code = errorCode(payload);
  if (status === 409 || code === "revision_conflict") {
    return new HostedAdapterError("revision_conflict", 409, payload?.current_revision);
  }
  if (code === "name_taken") return new HostedAdapterError("name_taken", status);
  if (code === "profile_exists") return new HostedAdapterError("profile_exists", status);
  if (Object.values(WRITING_RPC_NAMES).includes(name) && ["writing_record_invalid", "invalid_record"].includes(code)) {
    return new HostedAdapterError("writing_record_invalid", status);
  }
  if (["invalid_access", "invalid_access_code", "invalid_credentials", "unauthorized", "forbidden"].includes(code) || status === 401 || status === 403) {
    return new HostedAdapterError("invalid_credentials", status);
  }
  if ([LEGACY_RPC_NAMES.health, QUALITY_RPC_NAMES.health, WRITING_RPC_NAMES.health].includes(name) &&
      (status === 404 || ["study_not_ready", "study_mismatch"].includes(code))) {
    return new HostedAdapterError("backend_not_ready", status);
  }
  if (["study_not_ready", "study_mismatch"].includes(code)) return new HostedAdapterError("backend_not_ready", status);
  return new HostedAdapterError("service_unavailable", status);
}

function safeAuthFailure(error) {
  const code = typeof error?.code === "string" ? error.code.toLowerCase() : "";
  if (["anonymous_provider_disabled", "signup_disabled", "provider_disabled"].includes(code)) {
    return new HostedAdapterError("anonymous_auth_unavailable", error?.status || 0);
  }
  return new HostedAdapterError("service_unavailable", error?.status || 0);
}

/**
 * The Supabase SDK's PostgREST client can use the publishable key as a Bearer
 * value when no session exists. Keep the key as `apikey`, but never present it
 * to PostgREST as an access token. A real anonymous JWT is left untouched.
 */
export function stripPublishableKeyBearer(fetchImpl, publishableKey) {
  if (typeof fetchImpl !== "function" || typeof publishableKey !== "string") fail("service_unavailable");
  return (input, init = {}) => {
    const requestHeaders = typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined;
    const options = init && typeof init === "object" ? init : {};
    const sourceHeaders = Object.hasOwn(options, "headers") ? options.headers : requestHeaders;
    const headers = new Headers(sourceHeaders);
    if (headers.get("Authorization") === `Bearer ${publishableKey}`) headers.delete("Authorization");
    return fetchImpl(input, { ...options, headers });
  };
}

function makeStorageKey(config, location) {
  const origin = typeof location?.origin === "string" ? location.origin : "unknown-origin";
  const project = new URL(config.supabase_url).hostname;
  const study = config.study_id;
  return `xacl-${`${origin}|${project}|${study}`.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

function validAnnotatorId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

export function randomRecoveryCode(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.getRandomValues !== "function") fail("crypto_unavailable");
  const bytes = cryptoProvider.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createHostedAdapter(config, {
  fetchImpl = globalThis.fetch?.bind(globalThis),
  supabaseLibrary = globalThis.supabase,
  location = globalThis.location,
  rubricVersion,
  guidanceVersion,
  guidanceSha256,
} = {}) {
  const checkedConfig = validateConfig(config);
  const quality = isQualityConfig(checkedConfig);
  const writing = isWritingConfig(checkedConfig);
  const recordIssue = quality ? qualityRecordIssue : writingRecordIssue;
  const rpcNames = writing ? WRITING_RPC_NAMES : quality ? QUALITY_RPC_NAMES : LEGACY_RPC_NAMES;
  const createClient = supabaseLibrary?.createClient;
  if (typeof fetchImpl !== "function" || typeof createClient !== "function") fail("service_unavailable");

  let client;
  try {
    client = createClient(checkedConfig.supabase_url, checkedConfig.supabase_publishable_key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: makeStorageKey(checkedConfig, location),
      },
      global: { fetch: stripPublishableKeyBearer(fetchImpl, checkedConfig.supabase_publishable_key) },
    });
  } catch {
    fail("service_unavailable");
  }
  if (!client?.auth || typeof client.rpc !== "function") fail("service_unavailable");

  async function rpc(name, args = {}) {
    if (!RPC_NAMES.has(name)) fail("service_unavailable");
    let result;
    try { result = await client.rpc(name, args); } catch (error) { throw safeRpcFailure(name, error?.status || 0, error); }
    if (result?.error) throw safeRpcFailure(name, result.error.status || result.status || 0, result.error);
    const payload = Array.isArray(result?.data) && result.data.length === 1 ? result.data[0] : result?.data;
    if (!isPlainObject(payload)) fail([LEGACY_RPC_NAMES.health, QUALITY_RPC_NAMES.health, WRITING_RPC_NAMES.health].includes(name) ? "backend_not_ready" : "service_unavailable");
    if (typeof payload.error === "string" || typeof payload.code === "string") throw safeRpcFailure(name, 200, payload);
    return payload;
  }

  function checkedRecord(payload, annotatorId = null) {
    const record = isPlainObject(payload?.record) ? payload.record : payload;
    if (quality || writing) {
      const issue = recordIssue(record, {
        annotatorId: annotatorId === null ? undefined : annotatorId,
        datasetId: checkedConfig.study_id,
        manifestSha256: checkedConfig.manifest_sha256,
        rubricVersion: rubricVersion || checkedConfig.rubric_version,
      });
      if (issue) fail(writing ? "writing_record_invalid" : "service_unavailable");
    } else if (!isPlainObject(record) || record.schema !== LEGACY_RECORD_SCHEMA || !validAnnotatorId(record.annotator_id) ||
        (annotatorId !== null && record.annotator_id !== annotatorId) ||
        record.dataset_id !== checkedConfig.study_id || record.manifest_sha256 !== checkedConfig.manifest_sha256 ||
        record.rubric_version !== rubricVersion || !Number.isInteger(record.revision) ||
        !isPlainObject(record.annotations)) fail("service_unavailable");
    return record;
  }

  function validateCredentials(annotatorId, recoveryCode) {
    if (!validAnnotatorId(annotatorId) || typeof recoveryCode !== "string" || !/^[0-9a-f]{64}$/.test(recoveryCode)) {
      fail("invalid_credentials", 401);
    }
  }

  return Object.freeze({
    storageKey: makeStorageKey(checkedConfig, location),

    async health() { return rpc(rpcNames.health); },

    async getSession() {
      try {
        const result = await client.auth.getSession();
        if (result?.error) throw safeAuthFailure(result.error);
        return result?.data?.session || null;
      } catch (error) {
        if (error instanceof HostedAdapterError) throw error;
        throw safeAuthFailure(error);
      }
    },

    async signInAnonymously() {
      try {
        const result = await client.auth.signInAnonymously();
        if (result?.error) throw safeAuthFailure(result.error);
        const session = result?.data?.session || await client.auth.getSession().then((sessionResult) => {
          if (sessionResult?.error) throw safeAuthFailure(sessionResult.error);
          return sessionResult?.data?.session || null;
        });
        if (!session?.access_token) fail("service_unavailable");
      } catch (error) {
        if (error instanceof HostedAdapterError) throw error;
        throw safeAuthFailure(error);
      }
    },

    async currentAnnotations() {
      const payload = await rpc(rpcNames.current);
      if (payload.record === null) return null;
      return checkedRecord(payload);
    },

    async register(annotatorId, recoveryCode) {
      validateCredentials(annotatorId, recoveryCode);
      const payload = await rpc(rpcNames.register, {
        p_annotator_id: annotatorId,
        p_recovery_code: recoveryCode,
      });
      return checkedRecord(payload, annotatorId);
    },

    async resume(annotatorId, recoveryCode) {
      validateCredentials(annotatorId, recoveryCode);
      const payload = await rpc(rpcNames.resume, {
        p_annotator_id: annotatorId,
        p_recovery_code: recoveryCode,
      });
      return checkedRecord(payload, annotatorId);
    },

    async load(annotatorId) {
      if (!validAnnotatorId(annotatorId)) fail("invalid_credentials", 401);
      const payload = await rpc(rpcNames.load, { p_annotator_id: annotatorId });
      return checkedRecord(payload, annotatorId);
    },

    async save(annotatorId, record, operation = "save") {
      if (!validAnnotatorId(annotatorId) || !isPlainObject(record) || record.annotator_id !== annotatorId ||
          !["save", "import"].includes(operation)) fail("service_unavailable");
      if ((quality || writing) && recordIssue(record, {
        annotatorId,
        datasetId: checkedConfig.study_id,
        manifestSha256: checkedConfig.manifest_sha256,
        rubricVersion: rubricVersion || checkedConfig.rubric_version,
      })) fail(writing ? "writing_record_invalid" : "service_unavailable");
      const payload = await rpc(rpcNames.save, {
        p_annotator_id: annotatorId,
        p_record: record,
        p_guidance_version: guidanceVersion || checkedConfig.guidance_version,
        p_guidance_sha256: guidanceSha256 || checkedConfig.guidance_sha256,
        p_operation: operation,
      });
      const savedRecord = checkedRecord(payload, annotatorId);
      if (payload.saved_at !== undefined && typeof payload.saved_at !== "string") fail("service_unavailable");
      return { record: savedRecord, ...(payload.saved_at ? { saved_at: payload.saved_at } : {}) };
    },

    async signOut() {
      try {
        const result = await client.auth.signOut({ scope: "local" });
        if (result?.error) throw safeAuthFailure(result.error);
      } catch (error) {
        if (error instanceof HostedAdapterError) throw error;
        throw safeAuthFailure(error);
      }
    },
  });
}

export function assertHostedHealth(health, assets) {
  const protocolConfig = isProtocolConfig(assets.config);
  if (!isPlainObject(health) || health.ready !== true ||
      health.dataset_id !== assets.manifest.dataset_id ||
      health.manifest_sha256 !== assets.manifestHash ||
      health.rubric_version !== assets.rubric.version ||
      health.guidance_version !== assets.guidance.version ||
      health.guidance_sha256 !== assets.guidanceHash ||
      (protocolConfig && (health.protocol_id !== assets.config.protocol_id ||
        health.record_schema !== assets.config.record_schema ||
        health.rubric_sha256 !== assets.rubricHash)) ||
      health.auth_mode !== AUTH_MODE) fail("backend_not_ready");
  return true;
}
