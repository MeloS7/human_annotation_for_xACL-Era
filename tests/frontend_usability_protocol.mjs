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
  blankUsabilityAnnotation,
  usabilityAnnotationErrors,
  usabilityRecordIssue,
  USABILITY_NA_KEYS,
  USABILITY_PROTOCOL_ID,
  USABILITY_RECORD_SCHEMA,
  USABILITY_RUBRIC_VERSION,
  USABILITY_SCORE_KEYS,
} from "../site/usability-protocol.mjs";

const siteRoot = new URL("../site/", import.meta.url);
const config = JSON.parse(await readFile(new URL("config.json", siteRoot), "utf8"));
const manifest = JSON.parse(await readFile(new URL("manifest.json", siteRoot), "utf8"));
const auditPath = "protocols/latex-data-usability-v1/resource-audit.json";
const files = new Map([
  ["config.json", new Uint8Array(await readFile(new URL("config.json", siteRoot)))],
  ["manifest.json", new Uint8Array(await readFile(new URL("manifest.json", siteRoot)))],
  [config.rubric_path, new Uint8Array(await readFile(new URL(config.rubric_path, siteRoot)))],
  [config.guidance_path, new Uint8Array(await readFile(new URL(config.guidance_path, siteRoot)))],
  [auditPath, new Uint8Array(await readFile(new URL(auditPath, siteRoot)))],
]);
const stamp = "2026-11-04T12:00:00.000Z";
const expectedScoreValues = [1, 2, 3, 4, 5, "uncertain"];

function staticFetcher(overrides = {}) {
  const requested = [];
  const baseUrl = new URL("https://annotation.test/preview/");
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    requested.push(parsed.pathname.slice(baseUrl.pathname.length));
    const relative = requested.at(-1);
    const bytes = Object.hasOwn(overrides, relative) ? overrides[relative] : files.get(relative);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("missing", { status: 404 });
  };
  return { baseUrl, fetchImpl, requested };
}

function record(overrides = {}) {
  return {
    schema: USABILITY_RECORD_SCHEMA,
    protocol_id: USABILITY_PROTOCOL_ID,
    dataset_id: config.study_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: USABILITY_RUBRIC_VERSION,
    annotator_id: "Reviewer_01",
    revision: 0,
    created_at: stamp,
    updated_at: stamp,
    annotations: {},
    ...overrides,
  };
}

function completedRow() {
  const row = blankUsabilityAnnotation(stamp);
  row.scores = Object.fromEntries(USABILITY_SCORE_KEYS.map((key) => [key, 4]));
  row.reviewed_full_scope = true;
  row.status = "completed";
  return row;
}

test("new usability annotation starts blank with four exact core keys and optional visual check", () => {
  const row = blankUsabilityAnnotation(stamp);
  assert.deepEqual(Object.keys(row.scores), [
    "text_integrity_readability",
    "document_structural_integrity",
    "nontext_asset_integrity",
    "overall_data_usability",
  ]);
  assert.deepEqual(USABILITY_NA_KEYS, ["nontext_asset_integrity"]);
  assert.deepEqual(row.auxiliary_checks.pdf_visual_integrity, {
    status: "not_assessed", score: null, issue_codes: [],
  });
  assert.deepEqual(usabilityAnnotationErrors(row), []);
});

test("only non-text assets allow N/A and completed review requires four answers plus scope confirmation", () => {
  const row = completedRow();
  assert.deepEqual(usabilityAnnotationErrors(row, { completed: true }), []);
  row.scores.nontext_asset_integrity = "na";
  assert.deepEqual(usabilityAnnotationErrors(row, { completed: true }), []);
  for (const key of USABILITY_SCORE_KEYS.filter((item) => item !== "nontext_asset_integrity")) {
    const invalid = structuredClone(row);
    invalid.scores[key] = "na";
    assert.ok(usabilityAnnotationErrors(invalid, { completed: true }).some((entry) => entry.key === "scores." + key));
  }
  const incomplete = completedRow();
  incomplete.scores.overall_data_usability = null;
  assert.ok(usabilityAnnotationErrors(incomplete, { completed: true }).some((entry) => entry.key === "scores.overall_data_usability"));
  incomplete.scores.overall_data_usability = 4;
  incomplete.reviewed_full_scope = false;
  assert.ok(usabilityAnnotationErrors(incomplete, { completed: true }).some((entry) => entry.key === "reviewed_full_scope"));
});

test("all five anchors and Uncertain validate, while optional visual rating never gates core completion", () => {
  for (const score of expectedScoreValues) {
    const row = completedRow();
    row.scores.text_integrity_readability = score;
    assert.deepEqual(usabilityAnnotationErrors(row, { completed: true }), [], "core score " + String(score));
  }
  const row = completedRow();
  row.auxiliary_checks.pdf_visual_integrity = { status: "assessed", score: 1, issue_codes: ["missing_glyphs"] };
  assert.deepEqual(usabilityAnnotationErrors(row, { completed: true }), []);
  const unchecked = completedRow();
  unchecked.auxiliary_checks.pdf_visual_integrity = { status: "not_assessed", score: 1, issue_codes: [] };
  assert.ok(usabilityAnnotationErrors(unchecked).some((entry) => entry.key === "auxiliary_checks.pdf_visual_integrity.score"));
});

test("new record identity is isolated from prior protocols and validates row shape strictly", () => {
  const valid = record({ annotations: { RL01: completedRow() } });
  assert.equal(usabilityRecordIssue(valid, {
    annotatorId: "Reviewer_01",
    datasetId: config.study_id,
    manifestSha256: config.manifest_sha256,
    rubricVersion: USABILITY_RUBRIC_VERSION,
  }), null);
  assert.equal(usabilityRecordIssue({ ...valid, protocol_id: "latex-writing-quality-9p-v1" }), "record_identity_invalid");
  assert.equal(usabilityRecordIssue({ ...valid, rubric_version: "latex-writing-quality-9p-rubric-v1" }), "record_identity_invalid");
  const extra = structuredClone(completedRow());
  extra.unapproved_field = true;
  assert.equal(usabilityRecordIssue(record({ annotations: { RL01: extra } })), "record_annotation_invalid");
});

test("canonical static package loads and binds all 30 resource entries to frozen manifest PDFs", async () => {
  const fixture = staticFetcher();
  const assets = await loadHostedAssets({ fetchImpl: fixture.fetchImpl, baseUrl: fixture.baseUrl, cryptoProvider: webcrypto });
  assert.equal(assets.config.protocol_id, USABILITY_PROTOCOL_ID);
  assert.equal(assets.config.record_schema, USABILITY_RECORD_SCHEMA);
  assert.deepEqual(assets.rubric.dimensions.map((dimension) => dimension.key), USABILITY_SCORE_KEYS);
  assert.equal(assets.resourceAuditIssue, "");
  assert.equal(Object.keys(assets.resourceAudit.papers).length, 30);
  assert.equal(assets.resourceAudit.papers.RL01.paper_id, manifest.papers[0].paper_id);
  assert.equal(assets.resourceAudit.papers.RL01.compiled_pdf_sha256, manifest.papers[0].compiled_pdf.sha256);
  assert.ok(fixture.requested.includes(auditPath));
  assertHostedHealth({
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
  }, assets);
});

test("resource-report fetch or hash failure leaves other review assets available", async () => {
  const fixture = staticFetcher({ [auditPath]: new TextEncoder().encode("{}") });
  const assets = await loadHostedAssets({ fetchImpl: fixture.fetchImpl, baseUrl: fixture.baseUrl, cryptoProvider: webcrypto });
  assert.equal(assets.resourceAudit, null);
  assert.equal(assets.resourceAuditIssue, "hash_mismatch");
  assert.equal(assets.rubric.version, config.rubric_version);
  assert.equal(assets.guidance.version, config.guidance_version);

  const missing = staticFetcher({ [auditPath]: null });
  const noReport = await loadHostedAssets({
    fetchImpl: async (url, options) => {
      const relative = new URL(url).pathname.slice(missing.baseUrl.pathname.length);
      if (relative === auditPath) return new Response("missing", { status: 404 });
      return missing.fetchImpl(url, options);
    },
    baseUrl: missing.baseUrl,
    cryptoProvider: webcrypto,
  });
  assert.equal(noReport.resourceAudit, null);
  assert.equal(noReport.rubric.version, config.rubric_version);
});

test("hosted adapter uses only usability RPCs and rejects cross-protocol records", async () => {
  const fixture = staticFetcher();
  const assets = await loadHostedAssets({ fetchImpl: fixture.fetchImpl, baseUrl: fixture.baseUrl, cryptoProvider: webcrypto });
  const calls = [];
  let currentRecord = record();
  let wrongHealth = false;
  const health = {
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
      if (name === "xacl_usability_annotation_health") {
        return { data: { ...health, ...(wrongHealth ? { protocol_id: "latex-writing-quality-9p-v1" } : {}) }, error: null };
      }
      if (name === "xacl_usability_register_annotator") return { data: { record: currentRecord }, error: null };
      throw new Error("Unexpected RPC " + name);
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
  wrongHealth = false;
  assert.equal((await hosted.register("Reviewer_01", "a".repeat(64))).schema, USABILITY_RECORD_SCHEMA);
  currentRecord = { ...currentRecord, protocol_id: "latex-writing-quality-9p-v1" };
  await assert.rejects(hosted.register("Reviewer_01", "a".repeat(64)),
    (error) => error instanceof HostedAdapterError && error.code === "usability_record_invalid");
  assert.ok(calls.every(({ name }) => name.startsWith("xacl_usability_")));
});
