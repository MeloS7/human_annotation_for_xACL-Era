import test from "node:test";
import assert from "node:assert/strict";
import {
  FOLLOWUP_EVIDENCE_SCHEMA,
  followupRecordIssue,
  followupStorageKey,
  findBundleFiles,
  normalizeBundlePath,
  sortFollowupPapers,
  validateFollowupEvidence,
  validateFollowupGuidance,
  validateFollowupHealth,
  validateFollowupManifest,
} from "../site/followup.mjs";

const hash = (char) => char.repeat(64);
const config = {
  schema: "xacl.followup49-config.v1",
  study_id: "revisionlens-alignment30-v1",
  dataset_id: "revisionlens-low-score49-v1",
  protocol_id: "latex-data-usability-followup49-v1",
  record_schema: "xacl.low-score-followup-annotations.v1",
  manifest_sha256: hash("a"), rubric_sha256: hash("b"),
  guidance_version: "low-score-followup-guidance-v1", guidance_sha256: hash("c"),
  evidence_sha256: hash("d"), rubric_version: "latex-data-usability-rubric-v1",
};

function makeManifest() {
  return {
    schema: "xacl.low-score-followup-manifest.v1",
    dataset_id: config.dataset_id,
    papers: Array.from({ length: 49 }, (_, index) => {
      const n = String(index + 1).padStart(3, "0");
      const issueIds = index === 0 ? ["pdf_visual_integrity", "page_9_coverage"] : ["nontext_asset_integrity"];
      return {
        sample_id: `J${n}`, paper_id: `paper.${n}`, title: `Paper ${n}`,
        selected_vN: `2301.${n}v1`, priority: index < 2 ? "priority" : "secondary",
        total_pdf_pages: 12, assigned_physical_pages: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        compiled_pdf: { file: `J${n}.pdf`, sha256: hash("e"), bytes: 100 + index },
        issues: issueIds.map((id) => ({ id })),
      };
    }),
  };
}

function makeRecord(manifest, annotations = {}) {
  return {
    schema: config.record_schema,
    protocol_id: config.protocol_id,
    dataset_id: config.dataset_id,
    manifest_sha256: config.manifest_sha256,
    rubric_version: config.rubric_version,
    annotator_id: "reviewer_1",
    revision: 0,
    created_at: "2026-11-06T09:00:00.000Z",
    updated_at: "2026-11-06T09:00:00.000Z",
    annotations,
  };
}

test("manifest routing keeps the 49-paper set isolated and prioritizes priority entries", () => {
  const manifest = makeManifest();
  assert.equal(validateFollowupManifest(manifest, config), manifest);
  const outOfOrder = [manifest.papers[2], manifest.papers[1], manifest.papers[0]];
  assert.deepEqual(sortFollowupPapers(outOfOrder).map((paper) => paper.sample_id), ["J002", "J001", "J003"]);
  assert.throws(() => validateFollowupManifest({ ...manifest, dataset_id: "revisionlens-alignment30-v1" }, config), /manifest/);
  assert.throws(() => validateFollowupManifest({ ...manifest, papers: manifest.papers.slice(1) }, config), /manifest/);
  const duplicated = makeManifest();
  duplicated.papers[1].sample_id = duplicated.papers[0].sample_id;
  assert.throws(() => validateFollowupManifest(duplicated, config), /paper entry/);
});

test("drafts may contain partial issue findings; completion requires every paper-specific issue", () => {
  const manifest = makeManifest();
  const draft = makeRecord(manifest, {
    J001: {
      status: "draft", updated_at: "2026-11-06T09:01:00.000Z",
      findings: { pdf_visual_integrity: { verdict: "confirmed", category: "pdf_rendering", note: "Page 2, clipped equation." } },
    },
  });
  assert.equal(followupRecordIssue(draft, config, manifest), null);
  const incomplete = structuredClone(draft);
  incomplete.annotations.J001.status = "completed";
  assert.equal(followupRecordIssue(incomplete, config, manifest), "record_incomplete");
  const complete = structuredClone(draft);
  complete.annotations.J001.status = "completed";
  complete.annotations.J001.findings.page_9_coverage = { verdict: "not_found", category: null, note: "" };
  assert.equal(followupRecordIssue(complete, config, manifest), null);
});

test("records reject cross-dataset rows, unknown issues, and oversized notes", () => {
  const manifest = makeManifest();
  const otherSet = makeRecord(manifest);
  otherSet.dataset_id = "revisionlens-alignment30-v1";
  assert.equal(followupRecordIssue(otherSet, config, manifest), "record_identity_invalid");
  const unknownIssue = makeRecord(manifest, {
    J001: { status: "draft", updated_at: "2026-11-06T09:01:00.000Z", findings: {
      text_integrity_readability: { verdict: "not_found", category: null, note: "" },
    } },
  });
  assert.equal(followupRecordIssue(unknownIssue, config, manifest), "record_finding_unknown");
  const oversized = makeRecord(manifest, {
    J001: { status: "draft", updated_at: "2026-11-06T09:01:00.000Z", findings: {
      pdf_visual_integrity: { verdict: "confirmed", category: null, note: "x".repeat(2001) },
    } },
  });
  assert.equal(followupRecordIssue(oversized, config, manifest), "record_finding_invalid");
});

test("bundle file matching is exact, local-path based, and reports ambiguity", () => {
  const first = { name: "J001.pdf", webkitRelativePath: "review/J001.pdf" };
  const second = { name: "J002.pdf", webkitRelativePath: "review/J002.pdf" };
  assert.equal(normalizeBundlePath(first), "J001.pdf");
  assert.deepEqual(findBundleFiles([first, second], "J001.pdf"), { file: first, count: 1 });
  assert.deepEqual(findBundleFiles([first, { ...first }], "J001.pdf"), { file: null, count: 2 });
  assert.deepEqual(findBundleFiles([first, second], "J003.pdf"), { file: null, count: 0 });
  assert.deepEqual(findBundleFiles([{ name: "J001.pdf", webkitRelativePath: "review/pdfs/J001.pdf" }], "J001.pdf"), { file: null, count: 0 });
});

test("guidance, evidence, and private health must match the follow-up protocol", () => {
  const manifest = makeManifest();
  const guidance = {
    schema: "xacl.low-score-followup-guidance.v1",
    version: config.guidance_version,
    purpose: "Review flagged issues.",
    instructions: ["Inspect the paper."], scope_note: "Check page 9 when assigned.",
    verdicts: { confirmed: "Present", not_found: "Resolved", insufficient_evidence: "Cannot decide" },
  };
  assert.equal(validateFollowupGuidance(guidance, config), guidance);
  const evidence = { schema: FOLLOWUP_EVIDENCE_SCHEMA, papers: {} };
  for (const paper of manifest.papers) {
    evidence.papers[paper.sample_id] = Object.fromEntries(paper.issues.map(({ id }) => [id, {
      gpt_reason: "Observed text or visual concern.", gemini_reason: "Independent observation.", scope_note: "",
    }]));
  }
  assert.equal(validateFollowupEvidence(evidence, manifest), evidence);
  const health = {
    ready: true, study_id: config.study_id, dataset_id: config.dataset_id,
    protocol_id: config.protocol_id, manifest_sha256: config.manifest_sha256,
    record_schema: config.record_schema, rubric_version: config.rubric_version,
    rubric_sha256: config.rubric_sha256, guidance_version: config.guidance_version,
    guidance_sha256: config.guidance_sha256, auth_mode: "anonymous_recovery_v1",
  };
  assert.equal(validateFollowupHealth(health, config), true);
  assert.equal(validateFollowupHealth({ ...health, study_id: "wrong-study" }, config), false);
});

test("follow-up page reuses the existing study auth-storage namespace", () => {
  assert.equal(
    followupStorageKey({ origin: "https://example.org", supabaseUrl: "https://project-id.supabase.co", studyId: "revisionlens-alignment30-v1" }),
    "xacl-https-example-org-project-id-supabase-co-revisionlens-alignment30-v1",
  );
});
