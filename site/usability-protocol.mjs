export const USABILITY_PROTOCOL_ID = "latex-data-usability-v1";
export const USABILITY_RECORD_SCHEMA = "xacl.latex-data-usability-annotations.v1";
export const USABILITY_RUBRIC_VERSION = "latex-data-usability-rubric-v1";
export const USABILITY_SCORE_KEYS = Object.freeze([
  "text_integrity_readability",
  "document_structural_integrity",
  "nontext_asset_integrity",
  "overall_data_usability",
]);
export const USABILITY_NA_KEYS = Object.freeze(["nontext_asset_integrity"]);
export const USABILITY_VERSION_DIFFERENCE_KEYS = Object.freeze([
  "text_revision",
  "scientific_content_revision",
  "technical_objects_revision",
  "structure_revision",
  "references_revision",
  "appendix_revision",
  "identity_uncertain",
]);
export const USABILITY_VISUAL_ISSUE_KEYS = Object.freeze([
  "missing_glyphs",
  "overlap",
  "clipping",
  "unexpected_blank_regions",
  "unreadable_objects",
]);

const RECORD_KEYS = Object.freeze([
  "schema", "protocol_id", "dataset_id", "manifest_sha256", "rubric_version",
  "annotator_id", "revision", "created_at", "updated_at", "annotations",
]);
const ANNOTATION_KEYS = Object.freeze([
  "scores", "auxiliary_checks", "version_differences", "version_notes", "reference_exposed",
  "reviewed_full_scope", "status", "updated_at",
]);
const PDF_VISUAL_KEYS = Object.freeze(["status", "score", "issue_codes"]);
const SAMPLE_IDS = Object.freeze(Array.from({ length: 30 }, (_, index) => `RL${String(index + 1).padStart(2, "0")}`));
const STUDY_ID = "revisionlens-alignment30-v1";
const MANIFEST_SHA256 = "d60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071";

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
function isScore(value, allowNA = false) {
  return value === null || value === "uncertain" || (allowNA && value === "na") ||
    (Number.isInteger(value) && value >= 1 && value <= 5);
}

export function blankUsabilityAnnotation(updatedAt = new Date().toISOString()) {
  return {
    scores: Object.fromEntries(USABILITY_SCORE_KEYS.map((key) => [key, null])),
    auxiliary_checks: { pdf_visual_integrity: { status: "not_assessed", score: null, issue_codes: [] } },
    version_differences: [],
    version_notes: "",
    reference_exposed: false,
    reviewed_full_scope: false,
    status: "draft",
    updated_at: updatedAt,
  };
}

export function usabilityAnnotationErrors(row, { completed = false } = {}) {
  const errors = [];
  if (!hasExactlyKeys(row, ANNOTATION_KEYS)) errors.push({ key: "annotation", error: "shape_invalid" });
  if (!hasExactlyKeys(row?.scores, USABILITY_SCORE_KEYS)) errors.push({ key: "scores", error: "shape_invalid" });
  const required = completed || row?.status !== "draft";
  for (const key of USABILITY_SCORE_KEYS) {
    if (!owns(row?.scores, key)) continue;
    const score = row.scores[key];
    if (!isScore(score, USABILITY_NA_KEYS.includes(key))) errors.push({ key: `scores.${key}`, error: "value_invalid" });
    else if (score === null && required) errors.push({ key: `scores.${key}`, error: "required" });
  }
  if (!hasExactlyKeys(row?.auxiliary_checks, ["pdf_visual_integrity"])) {
    errors.push({ key: "auxiliary_checks", error: "shape_invalid" });
  }
  const visual = row?.auxiliary_checks?.pdf_visual_integrity;
  if (!hasExactlyKeys(visual, PDF_VISUAL_KEYS)) errors.push({ key: "auxiliary_checks.pdf_visual_integrity", error: "shape_invalid" });
  else if (visual.status === "not_assessed") {
    if (visual.score !== null) errors.push({ key: "auxiliary_checks.pdf_visual_integrity.score", error: "value_invalid" });
    if (!Array.isArray(visual.issue_codes) || visual.issue_codes.length) errors.push({ key: "auxiliary_checks.pdf_visual_integrity.issue_codes", error: "value_invalid" });
  } else if (visual.status === "assessed") {
    if (!(visual.score === "uncertain" || (Number.isInteger(visual.score) && visual.score >= 1 && visual.score <= 5))) {
      errors.push({ key: "auxiliary_checks.pdf_visual_integrity.score", error: "value_invalid" });
    }
    if (!Array.isArray(visual.issue_codes)) errors.push({ key: "auxiliary_checks.pdf_visual_integrity.issue_codes", error: "type_invalid" });
    else {
      const seen = new Set();
      for (const issue of visual.issue_codes) {
        if (typeof issue !== "string" || !USABILITY_VISUAL_ISSUE_KEYS.includes(issue)) errors.push({ key: "auxiliary_checks.pdf_visual_integrity.issue_codes", error: "value_invalid" });
        else if (seen.has(issue)) errors.push({ key: "auxiliary_checks.pdf_visual_integrity.issue_codes", error: "duplicate" });
        seen.add(issue);
      }
    }
  } else errors.push({ key: "auxiliary_checks.pdf_visual_integrity.status", error: "value_invalid" });

  if (!Array.isArray(row?.version_differences)) errors.push({ key: "version_differences", error: "type_invalid" });
  else {
    const seen = new Set();
    for (const item of row.version_differences) {
      if (typeof item !== "string" || !USABILITY_VERSION_DIFFERENCE_KEYS.includes(item)) errors.push({ key: "version_differences", error: "value_invalid" });
      else if (seen.has(item)) errors.push({ key: "version_differences", error: "duplicate" });
      seen.add(item);
    }
  }
  if (typeof row?.version_notes !== "string") errors.push({ key: "version_notes", error: "type_invalid" });
  else if ([...row.version_notes].length > 12000) errors.push({ key: "version_notes", error: "too_long" });
  if (typeof row?.reference_exposed !== "boolean") errors.push({ key: "reference_exposed", error: "type_invalid" });
  if (typeof row?.reviewed_full_scope !== "boolean") errors.push({ key: "reviewed_full_scope", error: "type_invalid" });
  else if ((completed || row?.status === "completed") && !row.reviewed_full_scope) errors.push({ key: "reviewed_full_scope", error: "required" });
  if (!(row?.status === "draft" || row?.status === "completed")) errors.push({ key: "status", error: "value_invalid" });
  if (!isValidTimestamp(row?.updated_at)) errors.push({ key: "updated_at", error: "timestamp_invalid" });
  return errors;
}

export function usabilityRecordIssue(record, expected = {}) {
  if (!hasExactlyKeys(record, RECORD_KEYS)) return "record_shape_invalid";
  if (record.schema !== USABILITY_RECORD_SCHEMA || record.protocol_id !== USABILITY_PROTOCOL_ID ||
      record.dataset_id !== (expected.datasetId || STUDY_ID) ||
      record.manifest_sha256 !== (expected.manifestSha256 || MANIFEST_SHA256) ||
      record.rubric_version !== (expected.rubricVersion || USABILITY_RUBRIC_VERSION) ||
      (expected.annotatorId !== undefined && record.annotator_id !== expected.annotatorId) ||
      typeof record.annotator_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(record.annotator_id)) return "record_identity_invalid";
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) return "record_revision_invalid";
  if (!isValidTimestamp(record.created_at) || !isValidTimestamp(record.updated_at)) return "record_timestamp_invalid";
  if (!isPlainObject(record.annotations) || Object.keys(record.annotations).some((id) => !SAMPLE_IDS.includes(id))) return "record_annotations_invalid";
  for (const row of Object.values(record.annotations)) {
    if (usabilityAnnotationErrors(row, { completed: row?.status === "completed" }).length) return "record_annotation_invalid";
  }
  return null;
}
