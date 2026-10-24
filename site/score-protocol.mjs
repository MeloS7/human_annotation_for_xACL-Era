export const OBJECT_SCORE_KEYS = Object.freeze(["figure", "table", "equation"]);
export const OBJECT_SCORE_REASONS = Object.freeze([
  "missing_in_compiled",
  "added_in_compiled",
  "non_corresponding",
]);
export const INTEGRATED_SCORING_PROTOCOL = "integrated-presence-v1";

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const SCORE_FIELDS = Object.freeze([
  "text_alignment", "figure_alignment", "table_alignment", "equation_alignment",
  "structure_alignment", "content_coverage", "overall_alignment", "visual_integrity",
]);
const LEGACY_ANNOTATION_FIELDS = Object.freeze([
  "scores", "objects", "evidence", "notes", "flags", "reviewed_full_scope", "status", "updated_at",
]);

function hasExactlyKeys(value, expected) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every((key) => owns(value, key)));
}

export function objectScoringMode(row) {
  const hasProtocol = owns(row, "scoring_protocol");
  const hasReasons = owns(row, "object_score_reasons");
  if (!hasProtocol && !hasReasons) return "legacy";
  if (row?.scoring_protocol !== INTEGRATED_SCORING_PROTOCOL) return "unsupported";
  const reasons = row?.object_score_reasons;
  if (!reasons || typeof reasons !== "object" || Array.isArray(reasons) ||
      !OBJECT_SCORE_KEYS.every((key) => owns(reasons, key)) ||
      Object.keys(reasons).some((key) => !OBJECT_SCORE_KEYS.includes(key)) ||
      OBJECT_SCORE_KEYS.some((key) => reasons[key] !== null && !OBJECT_SCORE_REASONS.includes(reasons[key]))) {
    return "unsupported";
  }
  return "integrated";
}

export function integratedObjectFields() {
  return {
    scoring_protocol: INTEGRATED_SCORING_PROTOCOL,
    object_score_reasons: Object.fromEntries(OBJECT_SCORE_KEYS.map((key) => [key, null])),
  };
}

export function migrateLegacyObjectScores(record, updatedAt = new Date().toISOString()) {
  const migrated = structuredClone(record);
  const annotations = migrated?.annotations;
  const convertedSampleIds = [];
  const unsupportedSampleIds = [];
  if (!annotations || typeof annotations !== "object" || Array.isArray(annotations)) {
    return { record: migrated, changed: false, convertedSampleIds, unsupportedSampleIds };
  }

  const legacyRows = [];
  for (const [sampleId, row] of Object.entries(annotations)) {
    const mode = objectScoringMode(row);
    if (mode === "unsupported" || (mode === "legacy" &&
        (!hasExactlyKeys(row, LEGACY_ANNOTATION_FIELDS) ||
         !hasExactlyKeys(row.scores, SCORE_FIELDS) ||
         !hasExactlyKeys(row.objects, OBJECT_SCORE_KEYS) ||
         OBJECT_SCORE_KEYS.some((key) => !hasExactlyKeys(row.objects[key], ["compiled", "official"]))))) {
      unsupportedSampleIds.push(sampleId);
    } else if (mode === "legacy") {
      legacyRows.push([sampleId, row]);
    }
  }

  // Avoid partially migrating a record if any row has an unknown format.
  if (unsupportedSampleIds.length) {
    return { record: migrated, changed: false, convertedSampleIds, unsupportedSampleIds };
  }

  for (const [sampleId, row] of legacyRows) {
    for (const key of OBJECT_SCORE_KEYS) {
      row.scores[`${key}_alignment`] = null;
      row.objects[key] = { compiled: null, official: null };
    }
    Object.assign(row, integratedObjectFields(), {
      reviewed_full_scope: false,
      status: "draft",
      updated_at: updatedAt,
    });
    convertedSampleIds.push(sampleId);
  }
  if (convertedSampleIds.length) migrated.updated_at = updatedAt;
  return {
    record: migrated,
    changed: convertedSampleIds.length > 0,
    convertedSampleIds,
    unsupportedSampleIds,
  };
}

export function deriveObjectPresence(score, reason = null) {
  if (score === null || score === undefined) return { compiled: null, official: null };
  if (score === "na") return { compiled: "absent", official: "absent" };
  if (score === "uncertain") return { compiled: "uncertain", official: "uncertain" };
  if (score === 1) {
    if (reason === "missing_in_compiled") return { compiled: "absent", official: "present" };
    if (reason === "added_in_compiled") return { compiled: "present", official: "absent" };
    if (reason === "non_corresponding") return { compiled: "present", official: "present" };
    return { compiled: null, official: null };
  }
  if (Number.isInteger(score) && score >= 2 && score <= 5) return { compiled: "present", official: "present" };
  return null;
}

export function setIntegratedObjectScore(row, key, score, reason = null) {
  if (objectScoringMode(row) !== "integrated" || !OBJECT_SCORE_KEYS.includes(key)) return false;
  const presence = deriveObjectPresence(score, reason);
  if (!presence || (score === 1 && reason !== null && !OBJECT_SCORE_REASONS.includes(reason)) ||
      (score !== 1 && reason !== null)) return false;
  row.scores[`${key}_alignment`] = score;
  row.object_score_reasons[key] = reason;
  row.objects[key] = presence;
  return true;
}

export function validateIntegratedObjectScores(row) {
  if (objectScoringMode(row) !== "integrated") return [];
  return OBJECT_SCORE_KEYS.flatMap((key) => {
    const score = row.scores?.[`${key}_alignment`];
    const reason = row.object_score_reasons[key];
    if (score !== 1 && reason !== null) return [{ key, error: "stale_reason" }];
    const expected = deriveObjectPresence(score, reason);
    if (!expected) return [{ key, error: "invalid_score" }];
    if (score === 1 && reason === null) return [{ key, error: "missing_reason" }];
    const actual = row.objects?.[key];
    if (actual?.compiled !== expected.compiled || actual?.official !== expected.official) {
      return [{ key, error: "presence_mismatch" }];
    }
    return [];
  });
}
