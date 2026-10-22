const SITE_BASE_URL = new URL("./", import.meta.url);
const CONFIG_SCHEMA = "xacl.hosted-config.v1";
const MANIFEST_SCHEMA = "revisionlens.alignment30.manifest.v1";
const RUBRIC_SCHEMA = "revisionlens.alignment-rubric.v1";
const GUIDANCE_SCHEMA = "revisionlens.alignment-guidance.v1";
const RECORD_SCHEMA = "revisionlens.alignment-annotations.v1";
const AUTH_MODE = "anonymous_recovery_v1";
const RPC_NAMES = new Set([
  "xacl_annotation_health",
  "xacl_register_annotator",
  "xacl_resume_annotator",
  "xacl_current_annotations",
  "xacl_load_annotations",
  "xacl_save_annotations",
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

function parseJsonBytes(bytes) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function readStaticJson(name, baseUrl, fetchImpl) {
  const label = name.replace(/\.json$/i, "").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  const url = new URL(name, baseUrl);
  if (url.origin !== baseUrl.origin || !url.pathname.startsWith(baseUrl.pathname)) fail(`${label}_invalid`);
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
  if (!isPlainObject(config) || config.schema !== CONFIG_SCHEMA ||
      typeof config.study_id !== "string" || !config.study_id ||
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

  return { ...config, supabase_url: serviceUrl.origin, manifest_sha256: config.manifest_sha256.toLowerCase(), guidance_sha256: config.guidance_sha256.toLowerCase() };
}

function validateManifest(manifest, config, rubric) {
  if (!isPlainObject(manifest) || manifest.schema !== MANIFEST_SCHEMA ||
      manifest.dataset_id !== config.study_id || manifest.rubric_version !== rubric.version ||
      !Array.isArray(manifest.papers) || manifest.papers.length !== 30) fail("manifest_invalid");
  const seen = new Set();
  for (const paper of manifest.papers) {
    if (!isPlainObject(paper) || typeof paper.sample_id !== "string" || !paper.sample_id || seen.has(paper.sample_id) ||
        !isPlainObject(paper.compiled_pdf) || !isPlainObject(paper.official_pdf) ||
        typeof paper.compiled_pdf.path !== "string" || typeof paper.official_pdf.path !== "string") fail("manifest_invalid");
    seen.add(paper.sample_id);
  }
}

function validateRubric(rubric, manifest) {
  if (!isPlainObject(rubric) || rubric.schema !== RUBRIC_SCHEMA || rubric.version !== manifest.rubric_version ||
      !Array.isArray(rubric.dimensions) || !Array.isArray(rubric.flags)) fail("rubric_invalid");
}

function validateGuidance(guidance, config) {
  const bilingual = (value) => isPlainObject(value) && typeof value.en === "string" && value.en.trim() &&
    typeof value.zh === "string" && value.zh.trim();
  if (!isPlainObject(guidance) || guidance.schema !== GUIDANCE_SCHEMA || guidance.version !== config.guidance_version ||
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
  const [manifestFile, rubricFile, guidanceFile] = await Promise.all([
    readStaticJson("manifest.json", siteBase, fetchImpl),
    readStaticJson("rubric.json", siteBase, fetchImpl),
    readStaticJson("guidance.json", siteBase, fetchImpl),
  ]);
  const [manifestHash, guidanceHash] = await Promise.all([
    sha256Hex(manifestFile.bytes, cryptoProvider), sha256Hex(guidanceFile.bytes, cryptoProvider),
  ]);
  if (manifestHash !== config.manifest_sha256 || guidanceHash !== config.guidance_sha256) fail("static_hash_mismatch");
  const rubric = rubricFile.value;
  const manifest = manifestFile.value;
  const guidance = guidanceFile.value;
  validateRubric(rubric, manifest);
  validateManifest(manifest, config, rubric);
  validateGuidance(guidance, config);
  return Object.freeze({ config, manifest, rubric, guidance, manifestHash, guidanceHash });
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
  if (["invalid_access", "invalid_access_code", "invalid_credentials", "unauthorized", "forbidden"].includes(code) || status === 401 || status === 403) {
    return new HostedAdapterError("invalid_credentials", status);
  }
  if (name === "xacl_annotation_health" && (status === 404 || ["study_not_ready", "study_mismatch"].includes(code))) {
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
    if (result?.error) throw safeRpcFailure(name, result.error.status || 0, result.error);
    const payload = Array.isArray(result?.data) && result.data.length === 1 ? result.data[0] : result?.data;
    if (!isPlainObject(payload)) fail(name === "xacl_annotation_health" ? "backend_not_ready" : "service_unavailable");
    if (typeof payload.error === "string" || typeof payload.code === "string") throw safeRpcFailure(name, 200, payload);
    return payload;
  }

  function checkedRecord(payload, annotatorId = null) {
    const record = isPlainObject(payload?.record) ? payload.record : payload;
    if (!isPlainObject(record) || record.schema !== RECORD_SCHEMA || !validAnnotatorId(record.annotator_id) ||
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

    async health() { return rpc("xacl_annotation_health"); },

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
      const payload = await rpc("xacl_current_annotations");
      if (payload.record === null) return null;
      return checkedRecord(payload);
    },

    async register(annotatorId, recoveryCode) {
      validateCredentials(annotatorId, recoveryCode);
      const payload = await rpc("xacl_register_annotator", {
        p_annotator_id: annotatorId,
        p_recovery_code: recoveryCode,
      });
      return checkedRecord(payload, annotatorId);
    },

    async resume(annotatorId, recoveryCode) {
      validateCredentials(annotatorId, recoveryCode);
      const payload = await rpc("xacl_resume_annotator", {
        p_annotator_id: annotatorId,
        p_recovery_code: recoveryCode,
      });
      return checkedRecord(payload, annotatorId);
    },

    async load(annotatorId) {
      if (!validAnnotatorId(annotatorId)) fail("invalid_credentials", 401);
      const payload = await rpc("xacl_load_annotations", { p_annotator_id: annotatorId });
      return checkedRecord(payload, annotatorId);
    },

    async save(annotatorId, record, operation = "save") {
      if (!validAnnotatorId(annotatorId) || !isPlainObject(record) || record.annotator_id !== annotatorId ||
          !["save", "import"].includes(operation)) fail("service_unavailable");
      const payload = await rpc("xacl_save_annotations", {
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
  if (!isPlainObject(health) || health.ready !== true ||
      health.dataset_id !== assets.manifest.dataset_id ||
      health.manifest_sha256 !== assets.manifestHash ||
      health.rubric_version !== assets.rubric.version ||
      health.guidance_version !== assets.guidance.version ||
      health.guidance_sha256 !== assets.guidanceHash ||
      health.auth_mode !== AUTH_MODE) fail("backend_not_ready");
  return true;
}
