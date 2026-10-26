import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import {
  assertHostedHealth,
  createHostedAdapter,
  HostedAdapterError,
  loadHostedAssets,
} from "../site/cloud.mjs";
import {
  blankQualityAnnotation,
  QUALITY_PROTOCOL_ID,
  QUALITY_RECORD_SCHEMA,
  QUALITY_SCORE_KEYS,
  qualityAnnotationErrors,
  qualityRecordIssue,
  VERSION_DIFFERENCE_KEYS,
} from "../site/quality-protocol.mjs";

const siteRoot = new URL("../site/", import.meta.url);
const protocolRoot = new URL("protocols/document-quality-v1/", siteRoot);
const fileBytes = new Map([
  ["config.json", new Uint8Array(await readFile(new URL("config.json", protocolRoot)))],
  ["manifest.json", new Uint8Array(await readFile(new URL("manifest.json", siteRoot)))],
  ["protocols/document-quality-v1/rubric.json", new Uint8Array(await readFile(new URL("rubric.json", protocolRoot)))],
  ["protocols/document-quality-v1/guidance.json", new Uint8Array(await readFile(new URL("guidance.json", protocolRoot)))],
]);
const config = JSON.parse(new TextDecoder().decode(fileBytes.get("config.json")));
const manifest = JSON.parse(new TextDecoder().decode(fileBytes.get("manifest.json")));
const rubric = JSON.parse(new TextDecoder().decode(fileBytes.get("protocols/document-quality-v1/rubric.json")));
const guidance = JSON.parse(new TextDecoder().decode(fileBytes.get("protocols/document-quality-v1/guidance.json")));
const baseUrl = new URL("https://annotation.test/site-preview/human_annotation_for_xACL-Era/");
const stamp = "2026-10-26T12:00:00.000Z";

function staticFetch(overrides = {}) {
  const requested = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    requested.push({ url: parsed, options });
    const relativePath = parsed.pathname.slice(baseUrl.pathname.length);
    const bytes = overrides[relativePath] ?? fileBytes.get(relativePath);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("missing", { status: 404 });
  };
  return { fetchImpl, requested };
}

function completedRow() {
  const row = blankQualityAnnotation(stamp);
  for (const key of QUALITY_SCORE_KEYS) row.scores[key] = 1;
  row.version_differences = [...VERSION_DIFFERENCE_KEYS];
  row.reviewed_full_scope = true;
  row.status = "completed";
  return row;
}

function qualityRecord(annotatorId = "Annotator_7", revision = 0, row = completedRow()) {
  return {
    schema: QUALITY_RECORD_SCHEMA,
    protocol_id: QUALITY_PROTOCOL_ID,
    dataset_id: manifest.dataset_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: rubric.version,
    annotator_id: annotatorId,
    revision,
    created_at: stamp,
    updated_at: stamp,
    annotations: Object.fromEntries(manifest.papers.map(({ sample_id }) => [sample_id, structuredClone(row)])),
  };
}

function healthRecord(overrides = {}) {
  return {
    ready: true,
    auth_mode: config.auth_mode,
    dataset_id: manifest.dataset_id,
    manifest_sha256: config.manifest_sha256,
    protocol_id: config.protocol_id,
    record_schema: config.record_schema,
    rubric_version: rubric.version,
    rubric_sha256: config.rubric_sha256,
    guidance_version: guidance.version,
    guidance_sha256: config.guidance_sha256,
    ...overrides,
  };
}

function adapterWith(rpcHandler, { session = null } = {}) {
  const requests = [];
  let currentSession = session;
  let optionsSeen;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: currentSession }, error: null }),
      signInAnonymously: async () => ({ data: { session: currentSession }, error: null }),
      signOut: async () => ({ error: null }),
    },
    rpc: async (name, args) => {
      requests.push({ name, args: structuredClone(args) });
      return { data: await rpcHandler(name, args), error: null };
    },
  };
  const supabaseLibrary = {
    createClient(url, key, options) {
      optionsSeen = { url, key, options };
      return client;
    },
  };
  const hosted = createHostedAdapter(config, {
    fetchImpl: async () => new Response(null, { status: 204 }),
    supabaseLibrary,
    location: { origin: "https://annotation.test" },
    rubricVersion: rubric.version,
    guidanceVersion: guidance.version,
    guidanceSha256: config.guidance_sha256,
  });
  return { hosted, requests, get optionsSeen() { return optionsSeen; } };
}

function adapterWithSdkResult(result) {
  const client = { auth: {}, rpc: async () => result };
  return createHostedAdapter(config, {
    fetchImpl: async () => new Response(null, { status: 204 }),
    supabaseLibrary: { createClient: () => client },
    location: { origin: "https://annotation.test" },
    rubricVersion: rubric.version,
    guidanceVersion: guidance.version,
    guidanceSha256: config.guidance_sha256,
  });
}

test("blank quality annotations start fully blank and the shared validator accepts completed responses", () => {
  const blank = blankQualityAnnotation(stamp);
  assert.deepEqual(blank.scores, Object.fromEntries(QUALITY_SCORE_KEYS.map((key) => [key, null])));
  assert.deepEqual(blank.version_differences, []);
  assert.equal(blank.version_notes, "");
  assert.equal(blank.evidence, "");
  assert.equal(blank.notes, "");
  assert.equal(blank.reviewed_full_scope, false);
  assert.equal(blank.status, "draft");
  assert.equal(blank.updated_at, stamp);
  assert.deepEqual(qualityAnnotationErrors(blank), []);

  const complete = completedRow();
  assert.deepEqual(qualityAnnotationErrors(complete), []);
  const highScoresWithEveryDifference = completedRow();
  for (const key of QUALITY_SCORE_KEYS) highScoresWithEveryDifference.scores[key] = 5;
  assert.deepEqual(highScoresWithEveryDifference.version_differences, [...VERSION_DIFFERENCE_KEYS]);
  assert.deepEqual(qualityAnnotationErrors(highScoresWithEveryDifference, { completed: true }), []);
  const uncertainAndNa = structuredClone(complete);
  uncertainAndNa.scores.language_clarity = "uncertain";
  uncertainAndNa.scores.technical_presentation = "na";
  assert.deepEqual(qualityAnnotationErrors(uncertainAndNa, { completed: true }), []);
});

test("quality annotation validation rejects invalid score types, unavailable N/A values, flags, and completion state", () => {
  for (const invalid of [0, 1.5, "3", 6, -1, true, {}]) {
    const row = blankQualityAnnotation(stamp);
    row.scores.coherence_flow = invalid;
    assert.ok(qualityAnnotationErrors(row).some(({ key }) => key === "scores.coherence_flow"), `reject ${String(invalid)}`);
  }
  for (const key of QUALITY_SCORE_KEYS.filter((key) => key !== "technical_presentation")) {
    const row = blankQualityAnnotation(stamp);
    row.scores[key] = "na";
    assert.ok(qualityAnnotationErrors(row).some((issue) => issue.key === `scores.${key}`));
  }
  const completed = completedRow();
  completed.version_differences = [...VERSION_DIFFERENCE_KEYS, "text_revision"];
  assert.ok(qualityAnnotationErrors(completed, { completed: true }).some(({ error }) => error === "duplicate"));
  completed.version_differences = ["legacy_flag"];
  assert.ok(qualityAnnotationErrors(completed, { completed: true }).some(({ error }) => error === "value_invalid"));
  completed.version_differences = [...VERSION_DIFFERENCE_KEYS];
  completed.reviewed_full_scope = "true";
  assert.ok(qualityAnnotationErrors(completed, { completed: true }).some(({ key }) => key === "reviewed_full_scope"));

  const unanswered = completedRow();
  unanswered.scores.visual_integrity = null;
  assert.ok(qualityAnnotationErrors(unanswered, { completed: true }).some(({ key, error }) => key === "scores.visual_integrity" && error === "required"));
  const unreviewed = completedRow();
  unreviewed.reviewed_full_scope = false;
  assert.ok(qualityAnnotationErrors(unreviewed, { completed: true }).some(({ key, error }) => key === "reviewed_full_scope" && error === "required"));
  const oversized = blankQualityAnnotation(stamp);
  oversized.notes = "x".repeat(12001);
  assert.ok(qualityAnnotationErrors(oversized).some(({ key, error }) => key === "notes" && error === "too_long"));
  const unicodeAtLimit = blankQualityAnnotation(stamp);
  unicodeAtLimit.notes = "😀".repeat(8000);
  assert.deepEqual(qualityAnnotationErrors(unicodeAtLimit), [], "astral Unicode counts as one PostgreSQL character");
  const unicodeOverLimit = blankQualityAnnotation(stamp);
  unicodeOverLimit.notes = "😀".repeat(12001);
  assert.ok(qualityAnnotationErrors(unicodeOverLimit).some(({ key, error }) => key === "notes" && error === "too_long"));
  const wrongTypes = blankQualityAnnotation(stamp);
  wrongTypes.evidence = null;
  wrongTypes.version_notes = { text: "not a string" };
  assert.ok(qualityAnnotationErrors(wrongTypes).some(({ key }) => key === "evidence"));
  assert.ok(qualityAnnotationErrors(wrongTypes).some(({ key }) => key === "version_notes"));
  const sixDigitTimestamp = blankQualityAnnotation("2026-10-26T12:00:00.123456Z");
  assert.deepEqual(qualityAnnotationErrors(sixDigitTimestamp), []);
  const sevenDigitTimestamp = blankQualityAnnotation("2026-10-26T12:00:00.1234567Z");
  assert.ok(qualityAnnotationErrors(sevenDigitTimestamp).some(({ key, error }) => key === "updated_at" && error === "timestamp_invalid"));
  const overlongTimestamp = blankQualityAnnotation(`2026-10-26T12:00:00.${"1".repeat(44)}Z`);
  assert.ok(qualityAnnotationErrors(overlongTimestamp).some(({ key, error }) => key === "updated_at" && error === "timestamp_invalid"));
  const extraFields = { ...blankQualityAnnotation(stamp), flags: [] };
  assert.ok(qualityAnnotationErrors(extraFields).some(({ key, error }) => key === "annotation" && error === "shape_invalid"));
});

test("quality record validation rejects old, cross-protocol, malformed, and mismatched records", () => {
  const record = qualityRecord();
  const expected = {
    annotatorId: record.annotator_id,
    datasetId: config.study_id,
    manifestSha256: config.manifest_sha256,
    rubricVersion: config.rubric_version,
  };
  assert.equal(qualityRecordIssue(record, expected), null);
  const legacyRecord = {
    schema: "revisionlens.alignment-annotations.v1",
    dataset_id: config.study_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: "alignment-rubric-v1",
    annotator_id: record.annotator_id,
    revision: 0,
    created_at: stamp,
    updated_at: stamp,
    annotations: {},
  };
  assert.equal(typeof qualityRecordIssue(legacyRecord, expected), "string");
  for (const mutate of [
    (value) => { value.schema = "revisionlens.alignment-annotations.v1"; },
    (value) => { value.protocol_id = "alignment-v1"; },
    (value) => { value.rubric_version = "alignment-rubric-v1"; },
    (value) => { value.revision = -1; },
    (value) => { value.revision = 0.5; },
    (value) => { value.created_at = "yesterday"; },
    (value) => { value.annotations.RL01.scores.visual_integrity = "5"; },
    (value) => { value.annotations.RL01.flags = []; },
  ]) {
    const malformed = structuredClone(record);
    mutate(malformed);
    assert.equal(typeof qualityRecordIssue(malformed, expected), "string");
  }
  const missingSample = structuredClone(record);
  missingSample.annotations = {};
  assert.equal(qualityRecordIssue(missingSample, expected), null, "a fresh record may have no visited papers");
  const partial = structuredClone(record);
  partial.annotations = { RL07: blankQualityAnnotation(stamp) };
  assert.equal(qualityRecordIssue(partial, expected), null, "a record may contain only papers already visited");
  const unknownSample = structuredClone(record);
  unknownSample.annotations = { RL31: blankQualityAnnotation(stamp) };
  assert.equal(qualityRecordIssue(unknownSample, expected), "record_annotations_invalid");
  const unsafeRevision = structuredClone(record);
  unsafeRevision.revision = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(qualityRecordIssue(unsafeRevision, expected), "record_revision_invalid");
  const mismatchedIdentity = qualityRecord(record.annotator_id, 0);
  assert.equal(qualityRecordIssue(mismatchedIdentity, { ...expected, datasetId: "other-study" }), "record_identity_invalid");
});

test("quality assets load from safe subpath-relative paths and verify rubric, guidance, and manifest hashes", async () => {
  const { fetchImpl, requested } = staticFetch();
  const assets = await loadHostedAssets({ fetchImpl, baseUrl, cryptoProvider: webcrypto });
  assert.equal(assets.manifestHash, config.manifest_sha256);
  assert.equal(assets.rubricHash, config.rubric_sha256);
  assert.equal(assets.guidanceHash, config.guidance_sha256);
  assert.equal(assets.manifest.papers.length, 30);
  assert.equal(assets.manifest.rubric_version, config.sample_rubric_version);
  assert.equal(assets.rubric.version, config.rubric_version);
  assert.deepEqual(requested.map(({ url }) => url.pathname).sort(), [
    "/site-preview/human_annotation_for_xACL-Era/config.json",
    "/site-preview/human_annotation_for_xACL-Era/manifest.json",
    "/site-preview/human_annotation_for_xACL-Era/protocols/document-quality-v1/guidance.json",
    "/site-preview/human_annotation_for_xACL-Era/protocols/document-quality-v1/rubric.json",
  ].sort());
  assert.ok(requested.every(({ options }) => options.credentials === "same-origin"));
  assertHostedHealth(healthRecord(), assets);
  for (const mismatch of [
    { protocol_id: "alignment-v1" },
    { record_schema: "revisionlens.alignment-annotations.v1" },
    { rubric_sha256: "f".repeat(64) },
    { guidance_sha256: "e".repeat(64) },
  ]) {
    assert.throws(() => assertHostedHealth(healthRecord(mismatch), assets),
      (error) => error instanceof HostedAdapterError && error.code === "backend_not_ready");
  }

  const unsafeConfig = structuredClone(config);
  unsafeConfig.rubric_path = "protocols/../rubric.json";
  const badBytes = new TextEncoder().encode(JSON.stringify(unsafeConfig));
  const broken = staticFetch({ "config.json": badBytes });
  await assert.rejects(loadHostedAssets({ fetchImpl: broken.fetchImpl, baseUrl, cryptoProvider: webcrypto }),
    (error) => error instanceof HostedAdapterError && error.code === "static_package_invalid");
  assert.deepEqual(broken.requested.map(({ url }) => url.pathname), ["/site-preview/human_annotation_for_xACL-Era/config.json"]);

  const tamperedRubric = new Uint8Array(fileBytes.get("protocols/document-quality-v1/rubric.json").length + 1);
  tamperedRubric.set(fileBytes.get("protocols/document-quality-v1/rubric.json"));
  tamperedRubric[tamperedRubric.length - 1] = 0x20;
  const tampered = staticFetch({ "protocols/document-quality-v1/rubric.json": tamperedRubric });
  await assert.rejects(loadHostedAssets({ fetchImpl: tampered.fetchImpl, baseUrl, cryptoProvider: webcrypto }),
    (error) => error instanceof HostedAdapterError && error.code === "static_hash_mismatch");
});

test("quality adapter reuses the legacy device session key and calls only its own RPC namespace", async () => {
  const nickname = "Annotator_7";
  const recoveryCode = "a".repeat(64);
  const revision0 = qualityRecord(nickname, 0);
  const revision1 = qualityRecord(nickname, 1);
  const calls = adapterWith(async (name) => {
    if (name === "xacl_quality_annotation_health") return healthRecord();
    if (name === "xacl_quality_current_annotations" || name === "xacl_quality_register_annotator" ||
        name === "xacl_quality_resume_annotator" || name === "xacl_quality_load_annotations") return { record: revision0 };
    if (name === "xacl_quality_save_annotations") return { record: revision1, saved_at: revision1.updated_at };
    throw new Error(`unexpected RPC ${name}`);
  });
  const { hosted, requests, optionsSeen } = calls;
  const legacyConfig = JSON.parse(new TextDecoder().decode(await readFile(new URL("protocols/alignment-v1/config.json", siteRoot))));
  const legacy = createHostedAdapter(legacyConfig, {
    fetchImpl: async () => new Response(null, { status: 204 }),
    supabaseLibrary: { createClient: () => ({ auth: {}, rpc: async () => ({ data: {} }) }) },
    location: { origin: "https://annotation.test" },
  });
  assert.equal(hosted.storageKey, legacy.storageKey);
  assert.equal(optionsSeen.options.auth.storageKey, legacy.storageKey);
  assert.equal(optionsSeen.options.auth.persistSession, true);
  assert.equal(optionsSeen.options.auth.autoRefreshToken, true);

  assert.deepEqual(await hosted.health(), healthRecord());
  assert.deepEqual(await hosted.currentAnnotations(), revision0);
  assert.deepEqual(await hosted.register(nickname, recoveryCode), revision0);
  assert.deepEqual(await hosted.resume(nickname, recoveryCode), revision0);
  assert.deepEqual(await hosted.load(nickname), revision0);
  assert.deepEqual(await hosted.save(nickname, revision0, "import"), { record: revision1, saved_at: revision1.updated_at });
  assert.deepEqual(requests.map(({ name }) => name), [
    "xacl_quality_annotation_health",
    "xacl_quality_current_annotations",
    "xacl_quality_register_annotator",
    "xacl_quality_resume_annotator",
    "xacl_quality_load_annotations",
    "xacl_quality_save_annotations",
  ]);
  assert.deepEqual(requests[2].args, { p_annotator_id: nickname, p_recovery_code: recoveryCode });
  assert.deepEqual(requests[4].args, { p_annotator_id: nickname });
  assert.deepEqual(requests[5].args, {
    p_annotator_id: nickname,
    p_record: revision0,
    p_guidance_version: guidance.version,
    p_guidance_sha256: config.guidance_sha256,
    p_operation: "import",
  });
  assert.ok(!JSON.stringify(requests.slice(4)).includes(recoveryCode));
});

test("RPC failures preserve the Supabase result status when error.status is absent", async () => {
  const healthAdapter = adapterWithSdkResult({
    data: null,
    error: { message: "private PostgREST schema details", code: "PGRST202" },
    status: 404,
  });
  await assert.rejects(healthAdapter.health(), (error) => {
    assert.ok(error instanceof HostedAdapterError);
    assert.equal(error.code, "backend_not_ready");
    assert.equal(error.status, 404);
    assert.equal(error.message.includes("private"), false);
    return true;
  });

  for (const status of [401, 403]) {
    const authAdapter = adapterWithSdkResult({
      data: null,
      error: { message: "private authorization details", code: "PGRST301" },
      status,
    });
    await assert.rejects(authAdapter.load("Annotator_7"), (error) => {
      assert.ok(error instanceof HostedAdapterError);
      assert.equal(error.code, "invalid_credentials");
      assert.equal(error.status, status);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  }
});

test("quality adapter rejects old or malformed records rather than migrating or prefilling them", async () => {
  const oldRecord = {
    schema: "revisionlens.alignment-annotations.v1",
    dataset_id: config.study_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: "alignment-rubric-v1",
    annotator_id: "Annotator_7",
    revision: 0,
    created_at: stamp,
    updated_at: stamp,
    annotations: {},
  };
  const { hosted, requests } = adapterWith(async (name) => {
    if (name === "xacl_quality_current_annotations") return { record: oldRecord };
    return {};
  });
  await assert.rejects(hosted.currentAnnotations(),
    (error) => error instanceof HostedAdapterError && error.code === "service_unavailable");
  const crossProtocol = structuredClone(qualityRecord());
  crossProtocol.protocol_id = "alignment-v1";
  await assert.rejects(hosted.save(crossProtocol.annotator_id, crossProtocol),
    (error) => error instanceof HostedAdapterError && error.code === "service_unavailable");
  assert.deepEqual(requests.map(({ name }) => name), ["xacl_quality_current_annotations"]);
});

test("quality adapter preserves empty and partial annotation collections and rejects unknown sample IDs", async () => {
  const empty = qualityRecord();
  empty.annotations = {};
  const partial = qualityRecord();
  partial.annotations = { RL04: blankQualityAnnotation(stamp) };
  for (const record of [empty, partial]) {
    const { hosted } = adapterWith(async (name) => name === "xacl_quality_current_annotations" ? { record } : {});
    const returned = await hosted.currentAnnotations();
    assert.deepEqual(returned, record);
    assert.deepEqual(Object.keys(returned.annotations), Object.keys(record.annotations), "the adapter must not prefill missing rows");
  }
  const unknown = qualityRecord();
  unknown.annotations = { RL31: blankQualityAnnotation(stamp) };
  const { hosted } = adapterWith(async (name) => name === "xacl_quality_current_annotations" ? { record: unknown } : {});
  await assert.rejects(hosted.currentAnnotations(),
    (error) => error instanceof HostedAdapterError && error.code === "service_unavailable");
});
