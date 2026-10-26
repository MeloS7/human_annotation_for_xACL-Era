export const QUALITY_PROTOCOL_ID = "document-quality-v1";
export const QUALITY_RECORD_SCHEMA = "xacl.document-quality-annotations.v1";
export const QUALITY_SCORE_KEYS = Object.freeze([
  "language_clarity",
  "coherence_flow",
  "structural_completeness",
  "technical_presentation",
  "visual_integrity",
  "overall_quality",
]);
export const VERSION_DIFFERENCE_KEYS = Object.freeze([
  "text_revision",
  "scientific_content_revision",
  "technical_objects_revision",
  "structure_revision",
  "references_revision",
  "appendix_revision",
  "identity_uncertain",
]);

const RECORD_KEYS = Object.freeze([
  "schema", "protocol_id", "dataset_id", "manifest_sha256", "rubric_version",
  "annotator_id", "revision", "created_at", "updated_at", "annotations",
]);
const ANNOTATION_KEYS = Object.freeze([
  "scores", "version_differences", "version_notes", "evidence", "notes",
  "reviewed_full_scope", "status", "updated_at",
]);
const SAMPLE_IDS = Object.freeze(Array.from({ length: 30 }, (_, index) => `RL${String(index + 1).padStart(2, "0")}`));
const STUDY_ID = "revisionlens-alignment30-v1";
const MANIFEST_SHA256 = "d60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071";
const RUBRIC_VERSION = "document-quality-rubric-v1";

const owns = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isPlainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));

function hasExactlyKeys(value, expected) {
  return isPlainObject(value) && Object.keys(value).length === expected.length && expected.every((key) => owns(value, key));
}

function isValidTimestamp(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function blankQualityAnnotation(updatedAt = new Date().toISOString()) {
  return {
    scores: Object.fromEntries(QUALITY_SCORE_KEYS.map((key) => [key, null])),
    version_differences: [],
    version_notes: "",
    evidence: "",
    notes: "",
    reviewed_full_scope: false,
    status: "draft",
    updated_at: updatedAt,
  };
}

/**
 * Validate one document-quality annotation without coercing or repairing it.
 * `completed` requests the completion checks; it defaults to false.
 */
export function qualityAnnotationErrors(row, { completed = false } = {}) {
  const errors = [];
  if (!hasExactlyKeys(row, ANNOTATION_KEYS)) errors.push({ key: "annotation", error: "shape_invalid" });

  if (!hasExactlyKeys(row?.scores, QUALITY_SCORE_KEYS)) {
    errors.push({ key: "scores", error: "shape_invalid" });
  }
  for (const key of QUALITY_SCORE_KEYS) {
    if (!owns(row?.scores, key)) continue;
    const score = row.scores[key];
    const allowed = score === null || score === "uncertain" ||
      (Number.isInteger(score) && score >= 1 && score <= 5) ||
      (key === "technical_presentation" && score === "na");
    if (!allowed) errors.push({ key: `scores.${key}`, error: "value_invalid" });
    else if (completed && score === null) errors.push({ key: `scores.${key}`, error: "required" });
  }

  if (!Array.isArray(row?.version_differences)) {
    errors.push({ key: "version_differences", error: "type_invalid" });
  } else {
    const seen = new Set();
    for (const difference of row.version_differences) {
      if (typeof difference !== "string" || !VERSION_DIFFERENCE_KEYS.includes(difference)) {
        errors.push({ key: "version_differences", error: "value_invalid" });
      } else if (seen.has(difference)) {
        errors.push({ key: "version_differences", error: "duplicate" });
      }
      seen.add(difference);
    }
  }

  for (const key of ["version_notes", "evidence", "notes"]) {
    if (typeof row?.[key] !== "string") errors.push({ key, error: "type_invalid" });
    else if ([...row[key]].length > 12000) errors.push({ key, error: "too_long" });
  }
  if (typeof row?.reviewed_full_scope !== "boolean") {
    errors.push({ key: "reviewed_full_scope", error: "type_invalid" });
  } else if (completed && !row.reviewed_full_scope) {
    errors.push({ key: "reviewed_full_scope", error: "required" });
  }
  if (!(["draft", "completed"].includes(row?.status))) errors.push({ key: "status", error: "value_invalid" });
  if (!isValidTimestamp(row?.updated_at)) errors.push({ key: "updated_at", error: "timestamp_invalid" });
  return errors;
}

/**
 * Return a stable issue code for an invalid quality record, or null when valid.
 * `expected` may override `datasetId`, `manifestSha256`, `rubricVersion`, and
 * `annotatorId` with the active, already-validated hosted configuration.
 */
export function qualityRecordIssue(record, expected = {}) {
  if (!hasExactlyKeys(record, RECORD_KEYS)) return "record_shape_invalid";
  if (record.schema !== QUALITY_RECORD_SCHEMA || record.protocol_id !== QUALITY_PROTOCOL_ID ||
      record.dataset_id !== (expected.datasetId || STUDY_ID) ||
      record.manifest_sha256 !== (expected.manifestSha256 || MANIFEST_SHA256) ||
      record.rubric_version !== (expected.rubricVersion || RUBRIC_VERSION) ||
      (expected.annotatorId !== undefined && record.annotator_id !== expected.annotatorId) ||
      typeof record.annotator_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(record.annotator_id)) {
    return "record_identity_invalid";
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) return "record_revision_invalid";
  if (!isValidTimestamp(record.created_at) || !isValidTimestamp(record.updated_at)) return "record_timestamp_invalid";
  if (!isPlainObject(record.annotations) || Object.keys(record.annotations).some((sampleId) => !SAMPLE_IDS.includes(sampleId))) {
    return "record_annotations_invalid";
  }
  for (const row of Object.values(record.annotations)) {
    if (qualityAnnotationErrors(row, { completed: row?.status === "completed" }).length) return "record_annotation_invalid";
  }
  return null;
}
