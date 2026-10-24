import test from "node:test";
import assert from "node:assert/strict";
import {
  INTEGRATED_SCORING_PROTOCOL,
  OBJECT_SCORE_KEYS,
  deriveObjectPresence,
  integratedObjectFields,
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

test("legacy rows are recognized without assigning fields or changing original values", () => {
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
