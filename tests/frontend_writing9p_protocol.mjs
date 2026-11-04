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
  blankWriting9pAnnotation,
  coreScoringPageCount,
  writing9pAnnotationErrors,
  writing9pRecordIssue,
  WRITING_9P_PROTOCOL_ID,
  WRITING_9P_RECORD_SCHEMA,
  WRITING_9P_RUBRIC_VERSION,
  WRITING_9P_SCORE_KEYS,
} from "../site/writing9p-protocol.mjs";

const siteRoot = new URL("../site/", import.meta.url);
const config = JSON.parse(await readFile(new URL("protocols/latex-writing-quality-9p-v1/config.json", siteRoot), "utf8"));
const manifest = JSON.parse(await readFile(new URL("manifest.json", siteRoot), "utf8"));
const assetBytes = new Map([
  ["config.json", new Uint8Array(await readFile(new URL("protocols/latex-writing-quality-9p-v1/config.json", siteRoot)))],
  ["manifest.json", new Uint8Array(await readFile(new URL("manifest.json", siteRoot)))],
  [config.rubric_path, new Uint8Array(await readFile(new URL(config.rubric_path, siteRoot)))],
  [config.guidance_path, new Uint8Array(await readFile(new URL(config.guidance_path, siteRoot)))],
]);
const stamp = "2026-11-04T12:00:00.000Z";

function staticFetcher(overrides = {}) {
  const requested = [];
  const baseUrl = new URL("https://annotation.test/preview/");
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requested.push(parsed.pathname.slice(baseUrl.pathname.length));
    const relative = requested.at(-1);
    const bytes = overrides[relative] ?? assetBytes.get(relative);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("missing", { status: 404 });
  };
  return { baseUrl, fetchImpl, requested };
}

function writing9pRecord(overrides = {}) {
  return {
    schema: WRITING_9P_RECORD_SCHEMA,
    protocol_id: WRITING_9P_PROTOCOL_ID,
    dataset_id: config.study_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: WRITING_9P_RUBRIC_VERSION,
    annotator_id: "Writer_9P_01",
    revision: 0,
    created_at: stamp,
    updated_at: stamp,
    annotations: {},
    ...overrides,
  };
}

test("nine-page scope counts physical pages inclusively and caps only the scoring window", () => {
  assert.equal(coreScoringPageCount(1), 1);
  assert.equal(coreScoringPageCount(8), 8);
  assert.equal(coreScoringPageCount(9), 9);
  assert.equal(coreScoringPageCount(10), 9);
  assert.equal(coreScoringPageCount(100), 9);
  for (const invalid of [0, -1, 1.5, NaN, Infinity, "9", null, undefined]) {
    assert.equal(coreScoringPageCount(invalid), null, `invalid page count ${String(invalid)}`);
  }
});

test("nine-page records validate their own identity and the shared annotation shape", () => {
  const annotation = blankWriting9pAnnotation(stamp);
  assert.deepEqual(Object.keys(annotation.scores), WRITING_9P_SCORE_KEYS);
  assert.deepEqual(writing9pAnnotationErrors(annotation), []);

  const record = writing9pRecord({ annotations: { RL01: annotation } });
  assert.equal(writing9pRecordIssue(record, {
    annotatorId: "Writer_9P_01",
    datasetId: config.study_id,
    manifestSha256: config.manifest_sha256,
    rubricVersion: WRITING_9P_RUBRIC_VERSION,
  }), null);
  assert.equal(writing9pRecordIssue(record, { rubricVersion: "latex-writing-quality-rubric-v1" }), "record_identity_invalid");
  assert.equal(writing9pRecordIssue(record, { rubricVersion: "unexpected-rubric" }), "record_identity_invalid");

  for (const field of ["schema", "protocol_id", "rubric_version"]) {
    const wrongIdentity = writing9pRecord({ [field]: "latex-writing-quality-v1" });
    assert.equal(writing9pRecordIssue(wrongIdentity), "record_identity_invalid", `reject mismatched ${field}`);
  }
  assert.equal(writing9pRecordIssue(writing9pRecord({ annotator_id: "Other" }), {
    annotatorId: "Writer_9P_01",
  }), "record_identity_invalid");
});

test("nine-page record validator rejects inherited identity fields and malformed row data", () => {
  const inheritedIdentity = Object.create({
    schema: WRITING_9P_RECORD_SCHEMA,
    protocol_id: WRITING_9P_PROTOCOL_ID,
    rubric_version: WRITING_9P_RUBRIC_VERSION,
  });
  Object.assign(inheritedIdentity, writing9pRecord());
  delete inheritedIdentity.schema;
  delete inheritedIdentity.protocol_id;
  delete inheritedIdentity.rubric_version;
  assert.equal(writing9pRecordIssue(inheritedIdentity), "record_identity_invalid");

  const malformed = blankWriting9pAnnotation(stamp);
  malformed.scores.language_clarity = 6;
  assert.equal(writing9pRecordIssue(writing9pRecord({ annotations: { RL01: malformed } })), "record_annotation_invalid");
});

test("hosted assets validate the active nine-page IDs, paths, hashes, and scope contract", async () => {
  const fixture = staticFetcher();
  const assets = await loadHostedAssets({
    fetchImpl: fixture.fetchImpl,
    baseUrl: fixture.baseUrl,
    cryptoProvider: webcrypto,
  });
  assert.equal(assets.config.protocol_id, WRITING_9P_PROTOCOL_ID);
  assert.equal(assets.config.record_schema, WRITING_9P_RECORD_SCHEMA);
  assert.equal(assets.config.rubric_version, WRITING_9P_RUBRIC_VERSION);
  assert.equal(assets.rubric.protocol_id, WRITING_9P_PROTOCOL_ID);
  assert.equal(assets.guidance.protocol_id, WRITING_9P_PROTOCOL_ID);
  assert.deepEqual(fixture.requested.sort(), [
    "config.json",
    "manifest.json",
    config.guidance_path,
    config.rubric_path,
  ].sort());

  const wrongPathConfig = { ...config, rubric_path: "../latex-writing-quality-v1/rubric.json" };
  const invalidPath = staticFetcher({
    "config.json": new TextEncoder().encode(JSON.stringify(wrongPathConfig)),
  });
  await assert.rejects(
    loadHostedAssets({ fetchImpl: invalidPath.fetchImpl, baseUrl: invalidPath.baseUrl, cryptoProvider: webcrypto }),
    (error) => error instanceof HostedAdapterError && error.code === "static_package_invalid",
  );
  assert.deepEqual(invalidPath.requested, ["config.json"], "Invalid asset paths must be rejected before any rubric fallback fetch.");
  assert.equal(manifest.dataset_id, config.study_id);
});

test("hosted adapter uses only nine-page RPCs and rejects health or record identity mismatches", async () => {
  const fixture = staticFetcher();
  const assets = await loadHostedAssets({
    fetchImpl: fixture.fetchImpl,
    baseUrl: fixture.baseUrl,
    cryptoProvider: webcrypto,
  });
  const calls = [];
  let wrongHealth = false;
  let registrationRecord = {
    schema: WRITING_9P_RECORD_SCHEMA,
    protocol_id: WRITING_9P_PROTOCOL_ID,
    dataset_id: assets.manifest.dataset_id,
    manifest_sha256: assets.manifestHash,
    rubric_version: WRITING_9P_RUBRIC_VERSION,
    annotator_id: "Writer_9P_New",
    revision: 0,
    created_at: stamp,
    updated_at: stamp,
    annotations: {},
  };
  const validHealth = {
    ready: true,
    auth_mode: assets.config.auth_mode,
    dataset_id: assets.manifest.dataset_id,
    manifest_sha256: assets.manifestHash,
    protocol_id: assets.config.protocol_id,
    record_schema: assets.config.record_schema,
    rubric_version: assets.rubric.version,
    rubric_sha256: assets.rubricHash,
    guidance_version: assets.guidance.version,
    guidance_sha256: assets.guidanceHash,
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInAnonymously: async () => ({ data: { session: { access_token: "test-token" } }, error: null }),
      signOut: async () => ({ error: null }),
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "xacl_writing9p_annotation_health") {
        return { data: { ...validHealth, ...(wrongHealth ? { protocol_id: "latex-writing-quality-v1" } : {}) }, error: null };
      }
      if (name === "xacl_writing9p_register_annotator") return { data: { record: registrationRecord }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const hosted = createHostedAdapter(assets.config, {
    fetchImpl: async () => new Response(null, { status: 204 }),
    supabaseLibrary: { createClient: () => client },
    location: { origin: "https://annotation.test" },
    rubricVersion: assets.rubric.version,
    guidanceVersion: assets.guidance.version,
    guidanceSha256: assets.guidanceHash,
  });

  assertHostedHealth(await hosted.health(), assets);
  wrongHealth = true;
  await assert.rejects(async () => assertHostedHealth(await hosted.health(), assets),
    (error) => error instanceof HostedAdapterError && error.code === "backend_not_ready");
  assert.equal((await hosted.register("Writer_9P_New", "a".repeat(64))).schema, WRITING_9P_RECORD_SCHEMA,
    "A new empty nine-page profile record should be accepted.");

  registrationRecord = {
    ...registrationRecord,
    schema: "xacl.latex-writing-annotations.v1",
    protocol_id: "latex-writing-quality-v1",
    rubric_version: "latex-writing-quality-rubric-v1",
  };
  await assert.rejects(hosted.register("Writer_9P_New", "a".repeat(64)),
    (error) => error instanceof HostedAdapterError && error.code === "writing_record_invalid");
  assert.deepEqual(calls.map(({ name }) => name), [
    "xacl_writing9p_annotation_health",
    "xacl_writing9p_annotation_health",
    "xacl_writing9p_register_annotator",
    "xacl_writing9p_register_annotator",
  ]);
  assert.ok(calls.every(({ name }) => !name.startsWith("xacl_writing_") && name.startsWith("xacl_writing9p_")),
    "Nine-page configuration must never fall back to the archived writing RPC namespace.");
});
