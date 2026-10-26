import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import {
  assertHostedHealth,
  createHostedAdapter,
  HostedAdapterError,
  loadHostedAssets,
  sha256Hex,
} from "../site/cloud.mjs";
import {
  blankWritingAnnotation,
  writingAnnotationErrors,
  writingRecordIssue,
  WRITING_PROTOCOL_ID,
  WRITING_RECORD_SCHEMA,
  WRITING_SCORE_KEYS,
  VERSION_DIFFERENCE_KEYS,
  VISUAL_ISSUE_KEYS,
} from "../site/writing-protocol.mjs";

const siteRoot = new URL("../site/", import.meta.url);
const protocolRoot = new URL("protocols/latex-writing-quality-v1/", siteRoot);
const fileBytes = new Map([
  ["config.json", new Uint8Array(await readFile(new URL("config.json", siteRoot)))],
  ["manifest.json", new Uint8Array(await readFile(new URL("manifest.json", siteRoot)))],
  ["protocols/latex-writing-quality-v1/rubric.json", new Uint8Array(await readFile(new URL("rubric.json", protocolRoot)))],
  ["protocols/latex-writing-quality-v1/guidance.json", new Uint8Array(await readFile(new URL("guidance.json", protocolRoot)))],
]);
const config = JSON.parse(new TextDecoder().decode(fileBytes.get("config.json")));
const manifest = JSON.parse(new TextDecoder().decode(fileBytes.get("manifest.json")));
const rubric = JSON.parse(new TextDecoder().decode(fileBytes.get("protocols/latex-writing-quality-v1/rubric.json")));
const guidance = JSON.parse(new TextDecoder().decode(fileBytes.get("protocols/latex-writing-quality-v1/guidance.json")));
const baseUrl = new URL("https://annotation.test/preview/human_annotation_for_xACL-Era/");
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

function completeWritingRow() {
  const row = blankWritingAnnotation(stamp);
  for (const key of WRITING_SCORE_KEYS) row.scores[key] = 5;
  row.auxiliary_checks.pdf_visual_integrity = {
    status: "assessed",
    score: 1,
    issue_codes: [...VISUAL_ISSUE_KEYS],
  };
  row.version_differences = [...VERSION_DIFFERENCE_KEYS];
  row.reviewed_full_scope = true;
  row.status = "completed";
  return row;
}

function writingRecord(annotatorId = "Writer_01", revision = 0, annotations = {}) {
  return {
    schema: WRITING_RECORD_SCHEMA,
    protocol_id: WRITING_PROTOCOL_ID,
    dataset_id: manifest.dataset_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: rubric.version,
    annotator_id: annotatorId,
    revision,
    created_at: stamp,
    updated_at: stamp,
    annotations,
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
      const result = await rpcHandler(name, args);
      return result?.sdkResult || { data: result, error: null };
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

function adapterWithSdkResult(result, { rpcCalls = [] } = {}) {
  const client = { auth: {}, rpc: async (name) => { rpcCalls.push(name); return result; } };
  return createHostedAdapter(config, {
    fetchImpl: async () => new Response(null, { status: 204 }),
    supabaseLibrary: { createClient: () => client },
    location: { origin: "https://annotation.test" },
    rubricVersion: rubric.version,
    guidanceVersion: guidance.version,
    guidanceSha256: config.guidance_sha256,
  });
}

test("writing annotation defaults are fresh, draft-only, and structurally valid", () => {
  const blank = blankWritingAnnotation(stamp);
  assert.deepEqual(blank.scores, Object.fromEntries(WRITING_SCORE_KEYS.map((key) => [key, null])));
  assert.deepEqual(blank.auxiliary_checks, {
    pdf_visual_integrity: { status: "not_assessed", score: null, issue_codes: [] },
  });
  assert.deepEqual(blank.version_differences, []);
  assert.equal(blank.version_notes, "");
  assert.equal(blank.reference_exposed, false);
  assert.equal(blank.reviewed_full_scope, false);
  assert.equal(blank.status, "draft");
  assert.equal(blank.updated_at, stamp);
  assert.deepEqual(writingAnnotationErrors(blank), []);
  assert.ok(writingAnnotationErrors(blank, { completed: true }).some(({ error }) => error === "required"));
  assert.deepEqual(writingAnnotationErrors(completeWritingRow(), { completed: true }), []);
});

test("all five core 5s remain valid with auxiliary score 1 and every version difference", () => {
  const row = completeWritingRow();
  assert.deepEqual(row.version_differences, [...VERSION_DIFFERENCE_KEYS]);
  assert.deepEqual(row.auxiliary_checks.pdf_visual_integrity, {
    status: "assessed", score: 1, issue_codes: [...VISUAL_ISSUE_KEYS],
  });
  assert.deepEqual(writingAnnotationErrors(row, { completed: true }), []);

  const noAuxiliaryOrFlags = completeWritingRow();
  noAuxiliaryOrFlags.auxiliary_checks.pdf_visual_integrity = { status: "not_assessed", score: null, issue_codes: [] };
  noAuxiliaryOrFlags.version_differences = [];
  assert.deepEqual(writingAnnotationErrors(noAuxiliaryOrFlags, { completed: true }), [],
    "auxiliary checks and version observations do not gate completion");
});

test("core ratings reject N/A and completion requires all five ratings and full-scope review", () => {
  for (const invalid of ["na", 0, 1.5, "3", 6, true, {}]) {
    const row = blankWritingAnnotation(stamp);
    row.scores.technical_expression = invalid;
    assert.ok(writingAnnotationErrors(row).some(({ key }) => key === "scores.technical_expression"), `reject ${String(invalid)}`);
  }
  const completedWithNull = completeWritingRow();
  completedWithNull.scores.overall_writing_quality = null;
  assert.ok(writingAnnotationErrors(completedWithNull).some(({ key, error }) => key === "scores.overall_writing_quality" && error === "required"));
  const completedWithoutScope = completeWritingRow();
  completedWithoutScope.reviewed_full_scope = false;
  assert.ok(writingAnnotationErrors(completedWithoutScope).some(({ key, error }) => key === "reviewed_full_scope" && error === "required"));
  const wrongTypes = blankWritingAnnotation(stamp);
  wrongTypes.reference_exposed = "false";
  wrongTypes.reviewed_full_scope = 1;
  assert.ok(writingAnnotationErrors(wrongTypes).some(({ key }) => key === "reference_exposed"));
  assert.ok(writingAnnotationErrors(wrongTypes).some(({ key }) => key === "reviewed_full_scope"));
  const invalidStatus = blankWritingAnnotation(stamp);
  invalidStatus.status = "finished";
  assert.ok(writingAnnotationErrors(invalidStatus).some(({ key }) => key === "status"));
});

test("auxiliary visual states enforce exact shapes and whitelisted unique issues without N/A", () => {
  const tested = (value) => {
    const row = blankWritingAnnotation(stamp);
    row.auxiliary_checks.pdf_visual_integrity = value;
    return writingAnnotationErrors(row);
  };
  assert.deepEqual(tested({ status: "not_assessed", score: null, issue_codes: [] }), []);
  assert.deepEqual(tested({ status: "assessed", score: "uncertain", issue_codes: [] }), []);
  assert.deepEqual(tested({ status: "assessed", score: 4, issue_codes: ["overlap", "clipping"] }), []);
  for (const invalid of [
    { status: "not_assessed", score: 2, issue_codes: [] },
    { status: "not_assessed", score: null, issue_codes: ["overlap"] },
    { status: "assessed", score: null, issue_codes: [] },
    { status: "assessed", score: "na", issue_codes: [] },
    { status: "assessed", score: 7, issue_codes: [] },
    { status: "assessed", score: 4, issue_codes: ["overlap", "overlap"] },
    { status: "assessed", score: 4, issue_codes: ["old_flag"] },
    { status: "not_checked", score: null, issue_codes: [] },
    { status: "assessed", score: 4, issue_codes: [], legacy: true },
  ]) assert.ok(tested(invalid).length > 0, `reject ${JSON.stringify(invalid)}`);
  const extraAuxiliary = blankWritingAnnotation(stamp);
  extraAuxiliary.auxiliary_checks.other = {};
  assert.ok(writingAnnotationErrors(extraAuxiliary).some(({ key }) => key === "auxiliary_checks"));
});

test("writing flags, notes, and timestamps use strict unique, Unicode, and ISO constraints", () => {
  const duplicate = blankWritingAnnotation(stamp);
  duplicate.version_differences = ["text_revision", "text_revision"];
  assert.ok(writingAnnotationErrors(duplicate).some(({ error }) => error === "duplicate"));
  const unknown = blankWritingAnnotation(stamp);
  unknown.version_differences = ["legacy_flag"];
  assert.ok(writingAnnotationErrors(unknown).some(({ error }) => error === "value_invalid"));
  const unicodeLimit = blankWritingAnnotation(stamp);
  unicodeLimit.version_notes = "😀".repeat(8000);
  assert.deepEqual(writingAnnotationErrors(unicodeLimit), []);
  const unicodeOver = blankWritingAnnotation(stamp);
  unicodeOver.version_notes = "😀".repeat(12001);
  assert.ok(writingAnnotationErrors(unicodeOver).some(({ key, error }) => key === "version_notes" && error === "too_long"));
  const badTime = blankWritingAnnotation("2026-10-26T12:00:00.1234567Z");
  assert.ok(writingAnnotationErrors(badTime).some(({ key, error }) => key === "updated_at" && error === "timestamp_invalid"));
  const goodPrecision = blankWritingAnnotation("2026-10-26T12:00:00.123456Z");
  assert.deepEqual(writingAnnotationErrors(goodPrecision), []);
});

test("writing record validator accepts empty and partial records but rejects legacy, unknown, and unsafe records", () => {
  const expected = {
    annotatorId: "Writer_01",
    datasetId: config.study_id,
    manifestSha256: config.manifest_sha256,
    rubricVersion: config.rubric_version,
  };
  assert.equal(writingRecordIssue(writingRecord(), expected), null);
  assert.equal(writingRecordIssue(writingRecord("Writer_01", 3, { RL02: blankWritingAnnotation(stamp) }), expected), null);
  const unknownPaper = writingRecord("Writer_01", 3, { RL31: blankWritingAnnotation(stamp) });
  assert.equal(writingRecordIssue(unknownPaper, expected), "record_annotations_invalid");
  const oldProtocol = { ...writingRecord(), schema: "xacl.document-quality-annotations.v1" };
  assert.equal(typeof writingRecordIssue(oldProtocol, expected), "string");
  const unsafeRevision = writingRecord("Writer_01", Number.MAX_SAFE_INTEGER + 1);
  assert.equal(writingRecordIssue(unsafeRevision, expected), "record_revision_invalid");
  const badTimestamp = writingRecord();
  badTimestamp.created_at = "yesterday";
  assert.equal(writingRecordIssue(badTimestamp, expected), "record_timestamp_invalid");
  const extraKey = { ...writingRecord(), legacy: true };
  assert.equal(writingRecordIssue(extraKey, expected), "record_shape_invalid");
  assert.equal(writingRecordIssue(writingRecord(), { ...expected, rubricVersion: "old-rubric" }), "record_identity_invalid");
});

test("writing assets load only from v3 safe paths and verify rubric, guidance, manifest, and health identity", async () => {
  const { fetchImpl, requested } = staticFetch();
  const assets = await loadHostedAssets({ fetchImpl, baseUrl, cryptoProvider: webcrypto });
  assert.equal(assets.config.schema, "xacl.hosted-config.v3");
  assert.equal(assets.manifest.rubric_version, config.sample_rubric_version);
  assert.equal(assets.rubricHash, config.rubric_sha256);
  assert.equal(assets.guidanceHash, config.guidance_sha256);
  assert.equal(assets.rubric.dimensions.length, WRITING_SCORE_KEYS.length);
  assert.deepEqual(requested.map(({ url }) => url.pathname).sort(), [
    "/preview/human_annotation_for_xACL-Era/config.json",
    "/preview/human_annotation_for_xACL-Era/manifest.json",
    "/preview/human_annotation_for_xACL-Era/protocols/latex-writing-quality-v1/guidance.json",
    "/preview/human_annotation_for_xACL-Era/protocols/latex-writing-quality-v1/rubric.json",
  ].sort());
  assert.ok(requested.every(({ options }) => options.credentials === "same-origin"));
  assertHostedHealth(healthRecord(), assets);
  for (const mismatch of [
    { protocol_id: "document-quality-v1" },
    { record_schema: "xacl.document-quality-annotations.v1" },
    { rubric_sha256: "f".repeat(64) },
    { guidance_sha256: "e".repeat(64) },
  ]) assert.throws(() => assertHostedHealth(healthRecord(mismatch), assets),
    (error) => error instanceof HostedAdapterError && error.code === "backend_not_ready");

  const unsafeConfig = structuredClone(config);
  unsafeConfig.guidance_path = "protocols/../guidance.json";
  const invalid = staticFetch({ "config.json": new TextEncoder().encode(JSON.stringify(unsafeConfig)) });
  await assert.rejects(loadHostedAssets({ fetchImpl: invalid.fetchImpl, baseUrl, cryptoProvider: webcrypto }),
    (error) => error instanceof HostedAdapterError && error.code === "static_package_invalid");
  const tamperedGuidance = new Uint8Array(fileBytes.get("protocols/latex-writing-quality-v1/guidance.json").length + 1);
  tamperedGuidance.set(fileBytes.get("protocols/latex-writing-quality-v1/guidance.json"));
  tamperedGuidance[tamperedGuidance.length - 1] = 0x20;
  const tampered = staticFetch({ "protocols/latex-writing-quality-v1/guidance.json": tamperedGuidance });
  await assert.rejects(loadHostedAssets({ fetchImpl: tampered.fetchImpl, baseUrl, cryptoProvider: webcrypto }),
    (error) => error instanceof HostedAdapterError && error.code === "static_hash_mismatch");
});

test("writing rubric auxiliary metadata is schema-checked after its configured hash matches", async () => {
  for (const alter of [
    (value) => { delete value.auxiliary_pdf_visual_integrity; },
    (value) => { value.auxiliary_pdf_visual_integrity.scale_zh["5"] = ""; },
  ]) {
    const invalidRubric = structuredClone(rubric);
    alter(invalidRubric);
    const invalidRubricBytes = new TextEncoder().encode(JSON.stringify(invalidRubric));
    const matchingConfig = structuredClone(config);
    matchingConfig.rubric_sha256 = await sha256Hex(invalidRubricBytes, webcrypto);
    const fixture = staticFetch({
      "config.json": new TextEncoder().encode(JSON.stringify(matchingConfig)),
      "protocols/latex-writing-quality-v1/rubric.json": invalidRubricBytes,
    });
    await assert.rejects(loadHostedAssets({ fetchImpl: fixture.fetchImpl, baseUrl, cryptoProvider: webcrypto }),
      (error) => error instanceof HostedAdapterError && error.code === "rubric_invalid");
  }
});

test("writing adapter reuses existing identity and uses only xacl_writing RPCs", async () => {
  const nickname = "Writer_01";
  const recoveryCode = "a".repeat(64);
  const blank = writingRecord(nickname);
  const saved = writingRecord(nickname, 1);
  const calls = adapterWith(async (name) => {
    if (name === "xacl_writing_annotation_health") return healthRecord();
    if (["xacl_writing_current_annotations", "xacl_writing_register_annotator", "xacl_writing_resume_annotator", "xacl_writing_load_annotations"].includes(name)) {
      return { record: blank };
    }
    if (name === "xacl_writing_save_annotations") return { record: saved, saved_at: stamp };
    throw new Error(`unexpected RPC ${name}`);
  });
  const { hosted, requests, optionsSeen } = calls;
  const previousConfig = JSON.parse(new TextDecoder().decode(await readFile(new URL("protocols/alignment-v1/config.json", siteRoot))));
  const previousAdapter = createHostedAdapter(previousConfig, {
    fetchImpl: async () => new Response(null, { status: 204 }),
    supabaseLibrary: { createClient: () => ({ auth: {}, rpc: async () => ({ data: {} }) }) },
    location: { origin: "https://annotation.test" },
  });
  assert.equal(hosted.storageKey, previousAdapter.storageKey);
  assert.equal(optionsSeen.options.auth.storageKey, previousAdapter.storageKey);
  assert.equal(optionsSeen.options.auth.persistSession, true);

  assert.deepEqual(await hosted.health(), healthRecord());
  assert.deepEqual(await hosted.currentAnnotations(), blank);
  assert.deepEqual(await hosted.register(nickname, recoveryCode), blank);
  assert.deepEqual(await hosted.resume(nickname, recoveryCode), blank);
  assert.deepEqual(await hosted.load(nickname), blank);
  assert.deepEqual(await hosted.save(nickname, blank, "save"), { record: saved, saved_at: stamp });
  assert.deepEqual(requests.map(({ name }) => name), [
    "xacl_writing_annotation_health", "xacl_writing_current_annotations", "xacl_writing_register_annotator",
    "xacl_writing_resume_annotator", "xacl_writing_load_annotations", "xacl_writing_save_annotations",
  ]);
  assert.deepEqual(requests[2].args, { p_annotator_id: nickname, p_recovery_code: recoveryCode });
  assert.deepEqual(requests[4].args, { p_annotator_id: nickname });
  assert.deepEqual(requests[5].args, {
    p_annotator_id: nickname,
    p_record: blank,
    p_guidance_version: guidance.version,
    p_guidance_sha256: config.guidance_sha256,
    p_operation: "save",
  });
  assert.ok(!JSON.stringify(requests.slice(4)).includes(recoveryCode));
});

test("writing health does not fall back to another RPC and maps invalid records safely", async () => {
  const calls = [];
  const missing = adapterWithSdkResult({
    data: null,
    error: { message: "private PostgREST details", code: "PGRST202" },
    status: 404,
  }, { rpcCalls: calls });
  await assert.rejects(missing.health(), (error) => error.code === "backend_not_ready" && error.status === 404);
  assert.deepEqual(calls, ["xacl_writing_annotation_health"], "there is no legacy health fallback");

  for (const code of ["writing_record_invalid", "invalid_record"]) {
    const { hosted } = adapterWith(async () => ({ error: code, message: "private validation detail" }));
    await assert.rejects(hosted.save("Writer_01", writingRecord("Writer_01")), (error) => {
      assert.ok(error instanceof HostedAdapterError);
      assert.equal(error.code, "writing_record_invalid");
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  }
});

test("writing adapter strictly rejects old and cross-protocol records without conversion", async () => {
  const oldRecord = {
    schema: "xacl.document-quality-annotations.v1", protocol_id: "document-quality-v1",
    dataset_id: config.study_id, manifest_sha256: config.manifest_sha256,
    rubric_version: "document-quality-rubric-v1", annotator_id: "Writer_01", revision: 0,
    created_at: stamp, updated_at: stamp, annotations: {},
  };
  const calls = adapterWith(async () => ({ record: oldRecord }));
  await assert.rejects(calls.hosted.currentAnnotations(),
    (error) => error instanceof HostedAdapterError && error.code === "writing_record_invalid");
  assert.deepEqual(calls.requests.map(({ name }) => name), ["xacl_writing_current_annotations"]);
});
