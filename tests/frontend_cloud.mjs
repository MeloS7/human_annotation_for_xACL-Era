import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import {
  assertHostedHealth,
  createHostedAdapter,
  HostedAdapterError,
  loadHostedAssets,
  randomRecoveryCode,
  stripPublishableKeyBearer,
} from "../site/cloud.mjs";

const packageRoot = new URL("../", import.meta.url);
const siteRoot = new URL("site/", packageRoot);
const fixtureBytes = new Map();
for (const name of ["config.json", "manifest.json", "rubric.json", "guidance.json"]) {
  fixtureBytes.set(name, new Uint8Array(await readFile(new URL(name, siteRoot))));
}
const config = JSON.parse(new TextDecoder().decode(fixtureBytes.get("config.json")));
const manifest = JSON.parse(new TextDecoder().decode(fixtureBytes.get("manifest.json")));
const rubric = JSON.parse(new TextDecoder().decode(fixtureBytes.get("rubric.json")));
const guidance = JSON.parse(new TextDecoder().decode(fixtureBytes.get("guidance.json")));
const baseUrl = new URL("https://annotation.test/site-preview/human_annotation_for_xACL-Era/");

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function staticFetch(overrides = {}) {
  const requested = [];
  const fetchImpl = async (url, options = {}) => {
    requested.push({ url: new URL(url), options });
    const name = new URL(url).pathname.split("/").pop();
    const bytes = overrides[name] ?? fixtureBytes.get(name);
    return bytes ? new Response(bytes, { status: 200 }) : new Response("missing", { status: 404 });
  };
  return { fetchImpl, requested };
}

function annotationRecord(annotatorId, revision = 0) {
  const stamp = "2026-10-22T12:00:00.000Z";
  return {
    schema: "revisionlens.alignment-annotations.v1",
    dataset_id: manifest.dataset_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: rubric.version,
    annotator_id: annotatorId,
    revision,
    created_at: stamp,
    updated_at: stamp,
    annotations: {},
  };
}

function healthRecord(overrides = {}) {
  return {
    ready: true,
    auth_mode: "anonymous_recovery_v1",
    dataset_id: manifest.dataset_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: rubric.version,
    guidance_version: guidance.version,
    guidance_sha256: config.guidance_sha256,
    ...overrides,
  };
}

function adapterWith(rpcHandler, { session = null, fetchImpl = async () => jsonResponse({}) } = {}) {
  const requests = [];
  const authCalls = [];
  let currentSession = session;
  let optionsSeen;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: currentSession }, error: null }),
      signInAnonymously: async () => {
        authCalls.push(["signInAnonymously"]);
        currentSession = { access_token: "anon.jwt.token" };
        return { data: { session: currentSession }, error: null };
      },
      signOut: async (options) => {
        authCalls.push(["signOut", options]);
        currentSession = null;
        return { error: null };
      },
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
    fetchImpl,
    supabaseLibrary,
    location: { origin: "https://annotation.test" },
    rubricVersion: rubric.version,
    guidanceVersion: guidance.version,
    guidanceSha256: config.guidance_sha256,
  });
  return {
    hosted,
    requests,
    authCalls,
    get optionsSeen() { return optionsSeen; },
    get session() { return currentSession; },
    client,
  };
}

test("loads the frozen static package under a project subpath and checks the recovery auth mode", async () => {
  const { fetchImpl, requested } = staticFetch();
  const assets = await loadHostedAssets({ fetchImpl, baseUrl, cryptoProvider: webcrypto });
  assert.equal(assets.manifestHash, config.manifest_sha256);
  assert.equal(assets.guidanceHash, config.guidance_sha256);
  assert.equal(assets.manifest.papers.length, 30);
  assert.equal(config.auth_mode, "anonymous_recovery_v1");
  assertHostedHealth(healthRecord(), assets);
  assert.throws(() => assertHostedHealth(healthRecord({ auth_mode: "legacy_access_code" }), assets),
    (error) => error instanceof HostedAdapterError && error.code === "backend_not_ready");
  assert.deepEqual(requested.map(({ url }) => url.pathname).sort(), [
    "/site-preview/human_annotation_for_xACL-Era/config.json",
    "/site-preview/human_annotation_for_xACL-Era/guidance.json",
    "/site-preview/human_annotation_for_xACL-Era/manifest.json",
    "/site-preview/human_annotation_for_xACL-Era/rubric.json",
  ].sort());
  assert.ok(requested.every(({ options }) => options.credentials === "same-origin"));
});

test("a byte-level change to frozen guidance blocks package setup", async () => {
  const original = fixtureBytes.get("guidance.json");
  const changed = new Uint8Array(original.length + 1);
  changed.set(original);
  changed[changed.length - 1] = 0x20;
  const { fetchImpl } = staticFetch({ "guidance.json": changed });
  await assert.rejects(
    loadHostedAssets({ fetchImpl, baseUrl, cryptoProvider: webcrypto }),
    (error) => error instanceof HostedAdapterError && error.code === "static_hash_mismatch",
  );
});

test("the SDK adapter enables persisted anonymous sessions and strips only a publishable-key Bearer header", async () => {
  const { hosted, optionsSeen } = adapterWith(async (name) => name === "xacl_annotation_health" ? healthRecord() : {});
  assert.equal(optionsSeen.url, config.supabase_url);
  assert.equal(optionsSeen.key, config.supabase_publishable_key);
  assert.equal(optionsSeen.options.auth.persistSession, true);
  assert.equal(optionsSeen.options.auth.autoRefreshToken, true);
  assert.match(optionsSeen.options.auth.storageKey, /annotation-test.*revisionlens-alignment30-v1/);
  assert.equal(hosted.storageKey, optionsSeen.options.auth.storageKey);

  const seen = [];
  const wrapped = stripPublishableKeyBearer(async (input, init) => {
    seen.push({ input, headers: new Headers(init.headers) });
    return new Response(null, { status: 204 });
  }, config.supabase_publishable_key);
  await wrapped("https://api.test/rpc", {
    method: "POST",
    headers: new Headers({
      apikey: config.supabase_publishable_key,
      Authorization: `Bearer ${config.supabase_publishable_key}`,
      "X-Test": "preserved",
    }),
  });
  assert.equal(seen[0].headers.get("apikey"), config.supabase_publishable_key);
  assert.equal(seen[0].headers.has("authorization"), false);
  assert.equal(seen[0].headers.get("x-test"), "preserved");

  const jwtRequest = new Request("https://api.test/rpc", {
    method: "POST",
    headers: { apikey: config.supabase_publishable_key, Authorization: "Bearer real-anon-jwt" },
  });
  await wrapped(jwtRequest);
  assert.equal(seen[1].headers.get("authorization"), "Bearer real-anon-jwt");
  assert.equal(seen[1].headers.get("apikey"), config.supabase_publishable_key);

  await wrapped("https://api.test/rpc", { headers: { Authorization: `Bearer ${config.supabase_publishable_key}-other` } });
  assert.equal(seen[2].headers.get("authorization"), `Bearer ${config.supabase_publishable_key}-other`, "only the exact publishable-key bearer is removed");
});

test("registration, same-device continuation, recovery, loading, saving, and sign-out use the new RPC contract", async () => {
  const nickname = "Annotator_7";
  const recoveryCode = "a".repeat(64);
  const revision0 = annotationRecord(nickname, 0);
  const revision1 = annotationRecord(nickname, 1);
  const calls = adapterWith(async (name, args) => {
    if (name === "xacl_annotation_health") return healthRecord();
    if (name === "xacl_current_annotations") return { record: revision0 };
    if (name === "xacl_register_annotator" || name === "xacl_resume_annotator" || name === "xacl_load_annotations") return { record: revision0 };
    if (name === "xacl_save_annotations") return { record: revision1, saved_at: revision1.updated_at };
    throw new Error(`unexpected RPC ${name}`);
  });
  const { hosted, requests, authCalls } = calls;

  assert.equal(await hosted.getSession(), null);
  await hosted.signInAnonymously();
  assert.equal((await hosted.getSession()).access_token, "anon.jwt.token");
  assert.deepEqual(await hosted.currentAnnotations(), revision0);
  assert.deepEqual(await hosted.register(nickname, recoveryCode), revision0);
  assert.deepEqual(await hosted.resume(nickname, recoveryCode), revision0);
  assert.deepEqual(await hosted.load(nickname), revision0);
  const saved = await hosted.save(nickname, revision0, "import");
  assert.deepEqual(saved, { record: revision1, saved_at: revision1.updated_at });
  await hosted.signOut();
  assert.deepEqual(authCalls, [["signInAnonymously"], ["signOut", { scope: "local" }]]);

  assert.deepEqual(requests.map(({ name }) => name), [
    "xacl_current_annotations", "xacl_register_annotator", "xacl_resume_annotator", "xacl_load_annotations", "xacl_save_annotations",
  ]);
  assert.deepEqual(requests[0].args, {});
  assert.deepEqual(requests[1].args, { p_annotator_id: nickname, p_recovery_code: recoveryCode });
  assert.deepEqual(requests[2].args, { p_annotator_id: nickname, p_recovery_code: recoveryCode });
  assert.deepEqual(requests[3].args, { p_annotator_id: nickname });
  assert.deepEqual(requests[4].args, {
    p_annotator_id: nickname,
    p_record: revision0,
    p_guidance_version: guidance.version,
    p_guidance_sha256: config.guidance_sha256,
    p_operation: "import",
  });
  assert.ok(!JSON.stringify(requests.slice(3)).includes(recoveryCode), "recovery code must not be sent with normal load/save calls");
});

test("current profile can be absent and registration generates an unpersisted-format recovery code", async () => {
  const { hosted } = adapterWith(async (name) => {
    if (name === "xacl_current_annotations") return { record: null };
    return healthRecord();
  });
  assert.equal(await hosted.currentAnnotations(), null);
  const code = randomRecoveryCode({ getRandomValues: (bytes) => { bytes.fill(0xab); return bytes; } });
  assert.equal(code, "ab".repeat(32));
  assert.match(randomRecoveryCode(webcrypto), /^[0-9a-f]{64}$/);
  await assert.rejects(hosted.register("bad nickname", "a".repeat(64)), (error) => error.code === "invalid_credentials");
  await assert.rejects(hosted.resume("A01", "A".repeat(64)), (error) => error.code === "invalid_credentials");
});

test("backend identity and credential failures are reduced to safe categories", async () => {
  for (const [backendError, expected] of [["name_taken", "name_taken"], ["profile_exists", "profile_exists"], ["invalid_access", "invalid_credentials"]]) {
    const secret = "b".repeat(64);
    const { hosted } = adapterWith(async (name) => name === "xacl_register_annotator"
      ? { error: backendError, message: `private details ${secret}` }
      : { record: null });
    await assert.rejects(hosted.register("A01", secret), (error) => {
      assert.equal(error.code, expected);
      assert.equal(error.message, expected);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
  }

  let calls = 0;
  const { hosted } = adapterWith(async () => { calls += 1; return { error: "invalid_access" }; });
  await assert.rejects(hosted.resume("A01", "short"), (error) => error.code === "invalid_credentials");
  assert.equal(calls, 0, "malformed recovery codes are rejected before RPC");
});

test("revision conflicts and study setup errors are mapped without exposing backend messages", async () => {
  const { hosted } = adapterWith(async (name) => {
    if (name === "xacl_annotation_health") return { error: "study_not_ready", message: "private setup detail" };
    if (name === "xacl_save_annotations") return { error: "revision_conflict", current_revision: 9, message: "private revision info" };
    return { record: annotationRecord("A01") };
  }, { session: { access_token: "anon.jwt.token" } });
  await assert.rejects(hosted.health(), (error) => error.code === "backend_not_ready");
  await assert.rejects(hosted.save("A01", annotationRecord("A01")), (error) => {
    assert.equal(error.code, "revision_conflict");
    assert.equal(error.status, 409);
    assert.equal(error.currentRevision, 9);
    assert.equal(error.message.includes("private"), false);
    return true;
  });

  const health = await adapterWith(async (name) => name === "xacl_annotation_health" ? healthRecord() : {}).hosted.health();
  assert.equal(health.auth_mode, "anonymous_recovery_v1");
});
