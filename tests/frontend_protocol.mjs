import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATED_SCORING_PROTOCOL,
  OBJECT_SCORE_KEYS,
  deriveObjectPresence,
  integratedObjectFields,
  migrateLegacyObjectScores,
  objectScoringMode,
  setIntegratedObjectScore,
  validateIntegratedObjectScores,
} from "../site/score-protocol.mjs";

function row() {
  return {
    scores: Object.fromEntries([
      "figure_alignment", "table_alignment", "equation_alignment",
    ].map((key) => [key, null])),
    ...integratedObjectFields(),
    objects: Object.fromEntries(OBJECT_SCORE_KEYS.map((key) => [key, { compiled: null, official: null }])),
  };
}

test("new rows use the integrated protocol and start with blank presence", () => {
  const record = row();
  assert.equal(record.scoring_protocol, INTEGRATED_SCORING_PROTOCOL);
  assert.equal(objectScoringMode(record), "integrated");
  assert.deepEqual(record.object_score_reasons, { figure: null, table: null, equation: null });
  assert.deepEqual(validateIntegratedObjectScores(record), []);
});

test("N/A and Uncertain derive both-side presence directly", () => {
  assert.deepEqual(deriveObjectPresence("na"), { compiled: "absent", official: "absent" });
  assert.deepEqual(deriveObjectPresence("uncertain"), { compiled: "uncertain", official: "uncertain" });
  const record = row();
  for (const key of OBJECT_SCORE_KEYS) assert.equal(setIntegratedObjectScore(record, key, "na"), true);
  assert.deepEqual(validateIntegratedObjectScores(record), []);
});

test("score 1 without a reason maps to blank presence and remains an unfinished draft", () => {
  const record = row();
  assert.equal(setIntegratedObjectScore(record, "figure", 1), true);
  assert.deepEqual(record.objects.figure, { compiled: null, official: null });
  assert.equal(record.object_score_reasons.figure, null);
  assert.deepEqual(validateIntegratedObjectScores(record), [{ key: "figure", error: "missing_reason" }]);
});

test("each score-1 reason derives its explicit presence pattern", () => {
  const cases = [
    ["missing_in_compiled", { compiled: "absent", official: "present" }],
    ["added_in_compiled", { compiled: "present", official: "absent" }],
    ["non_corresponding", { compiled: "present", official: "present" }],
  ];
  for (const [reason, expected] of cases) {
    const record = row();
    assert.equal(setIntegratedObjectScore(record, "equation", 1, reason), true);
    assert.deepEqual(record.objects.equation, expected);
    assert.deepEqual(validateIntegratedObjectScores(record), []);
  }
});

test("scores 2–5 mean both versions contain the object type", () => {
  for (const score of [2, 3, 4, 5]) {
    assert.deepEqual(deriveObjectPresence(score), { compiled: "present", official: "present" });
  }
});

test("switching away from score 1 clears its reason and derives fresh presence", () => {
  const record = row();
  setIntegratedObjectScore(record, "table", 1, "missing_in_compiled");
  assert.equal(setIntegratedObjectScore(record, "table", 4), true);
  assert.equal(record.object_score_reasons.table, null);
  assert.deepEqual(record.objects.table, { compiled: "present", official: "present" });
});

test("a stale reason outside score 1 is rejected", () => {
  const record = row();
  record.scores.figure_alignment = 3;
  record.object_score_reasons.figure = "added_in_compiled";
  record.objects.figure = { compiled: "present", official: "present" };
  assert.deepEqual(validateIntegratedObjectScores(record), [{ key: "figure", error: "stale_reason" }]);
});

test("inconsistent score-presence mappings and unsupported protocol shapes are rejected", () => {
  const record = row();
  record.scores.figure_alignment = 4;
  record.objects.figure = { compiled: "absent", official: "present" };
  assert.deepEqual(validateIntegratedObjectScores(record), [{ key: "figure", error: "presence_mismatch" }]);
  const malformed = { ...row(), object_score_reasons: { figure: null } };
  assert.equal(objectScoringMode(malformed), "unsupported");
});

test("legacy rows migrate on a clone, resetting only the three object dimensions", () => {
  const legacy = {
    scores: {
      text_alignment: 4, figure_alignment: 3, table_alignment: "na", equation_alignment: 2,
      structure_alignment: 5, content_coverage: 4, overall_alignment: 3, visual_integrity: 5,
    },
    objects: {
      figure: { compiled: "present", official: "present" },
      table: { compiled: "absent", official: "absent" },
      equation: { compiled: "absent", official: "present" },
    },
    evidence: "original evidence", notes: "original notes", flags: ["appendix_difference"],
    reviewed_full_scope: true, status: "completed", updated_at: "2020-01-01T00:00:00.000Z",
  };
  const record = {
    schema: "revisionlens.alignment-annotations.v1", dataset_id: "study", manifest_sha256: "manifest",
    rubric_version: "rubric", annotator_id: "A01", revision: 7,
    created_at: "2019-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z",
    annotations: { RL01: legacy, RL02: row() },
  };
  const before = structuredClone(record);
  const migrationTime = "2026-10-24T12:00:00.000Z";
  const result = migrateLegacyObjectScores(record, migrationTime);
  const migrated = result.record.annotations.RL01;
  assert.equal(result.changed, true);
  assert.deepEqual(result.convertedSampleIds, ["RL01"]);
  assert.deepEqual(result.unsupportedSampleIds, []);
  assert.notEqual(result.record, record);
  assert.deepEqual(migrated.scores, {
    text_alignment: 4, figure_alignment: null, table_alignment: null, equation_alignment: null,
    structure_alignment: 5, content_coverage: 4, overall_alignment: 3, visual_integrity: 5,
  });
  assert.deepEqual(migrated.objects, {
    figure: { compiled: null, official: null },
    table: { compiled: null, official: null },
    equation: { compiled: null, official: null },
  });
  assert.deepEqual(migrated.object_score_reasons, { figure: null, table: null, equation: null });
  assert.equal(migrated.scoring_protocol, INTEGRATED_SCORING_PROTOCOL);
  assert.equal(migrated.evidence, legacy.evidence);
  assert.equal(migrated.notes, legacy.notes);
  assert.deepEqual(migrated.flags, legacy.flags);
  assert.equal(migrated.status, "draft");
  assert.equal(migrated.reviewed_full_scope, false);
  assert.equal(migrated.updated_at, migrationTime);
  assert.equal(result.record.created_at, record.created_at);
  assert.equal(result.record.revision, record.revision);
  assert.equal(result.record.updated_at, migrationTime);
  assert.equal(objectScoringMode(result.record.annotations.RL02), "integrated");
  assert.deepEqual(record, before, "migration must not mutate the server/input record");

  const second = migrateLegacyObjectScores(result.record, "2026-10-25T00:00:00.000Z");
  assert.equal(second.changed, false);
  assert.deepEqual(second.record, result.record, "already integrated rows must stay unchanged");
});

test("partially extended or malformed rows block migration without partial changes", () => {
  const legacy = {
    scores: {
      text_alignment: 4, figure_alignment: 3, table_alignment: "na", equation_alignment: 2,
      structure_alignment: 5, content_coverage: 4, overall_alignment: 3, visual_integrity: 5,
    },
    objects: Object.fromEntries(OBJECT_SCORE_KEYS.map((key) => [key, { compiled: "present", official: "present" }])),
    evidence: "", notes: "", flags: [], reviewed_full_scope: false, status: "draft", updated_at: "2020-01-01T00:00:00.000Z",
  };
  const partial = { ...row(), object_score_reasons: { figure: null } };
  const record = { revision: 3, annotations: { RL01: legacy, RL02: partial } };
  const before = structuredClone(record);
  const result = migrateLegacyObjectScores(record, "2026-10-24T12:00:00.000Z");
  assert.equal(result.changed, false);
  assert.deepEqual(result.convertedSampleIds, []);
  assert.deepEqual(result.unsupportedSampleIds, ["RL02"]);
  assert.deepEqual(result.record, before, "a bad row must prevent partial migration of the whole record");

  const malformedLegacy = { ...legacy, unexpected: "unknown extension" };
  const malformedResult = migrateLegacyObjectScores({ annotations: { RL03: malformedLegacy } });
  assert.equal(malformedResult.changed, false);
  assert.deepEqual(malformedResult.unsupportedSampleIds, ["RL03"]);
  assert.deepEqual(malformedResult.record.annotations.RL03, malformedLegacy);
});

test("legacy format detection does not mutate its input", () => {
  const legacy = {
    scores: { figure_alignment: 3 },
    objects: { figure: { compiled: "present", official: "absent" } },
  };
  const before = structuredClone(legacy);
  assert.equal(objectScoringMode(legacy), "legacy");
  assert.deepEqual(legacy, before);
  assert.equal(Object.hasOwn(legacy, "scoring_protocol"), false);
  assert.equal(Object.hasOwn(legacy, "object_score_reasons"), false);
});
