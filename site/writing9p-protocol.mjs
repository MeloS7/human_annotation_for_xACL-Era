import {
  blankWritingAnnotation,
  writingAnnotationErrors,
  writingRecordIssue,
  WRITING_PROTOCOL_ID,
  WRITING_RECORD_SCHEMA,
  WRITING_SCORE_KEYS,
  VERSION_DIFFERENCE_KEYS,
  VISUAL_ISSUE_KEYS,
} from "./writing-protocol.mjs";

export const WRITING_9P_PROTOCOL_ID = "latex-writing-quality-9p-v1";
export const WRITING_9P_RECORD_SCHEMA = "xacl.latex-writing-9p-annotations.v1";
export const WRITING_9P_RUBRIC_VERSION = "latex-writing-quality-9p-rubric-v1";
export const WRITING_9P_SCORE_KEYS = WRITING_SCORE_KEYS;
export const WRITING_9P_VERSION_DIFFERENCE_KEYS = VERSION_DIFFERENCE_KEYS;
export const WRITING_9P_VISUAL_ISSUE_KEYS = VISUAL_ISSUE_KEYS;
export const CORE_SCORING_PAGE_COUNT = 9;

const isPlainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));

/** Count the inclusive, assigned first-nine-page scoring window. */
export function coreScoringPageCount(totalPages) {
  return Number.isInteger(totalPages) && totalPages > 0
    ? Math.min(CORE_SCORING_PAGE_COUNT, totalPages)
    : null;
}

export const blankWriting9pAnnotation = blankWritingAnnotation;
export const writing9pAnnotationErrors = writingAnnotationErrors;

/**
 * Reuse the stable v1 structural validator while requiring every nine-page
 * protocol identity field to match exactly before adapting the record shape.
 */
export function writing9pRecordIssue(record, expected = {}) {
  if (!isPlainObject(record) ||
      !Object.hasOwn(record, "protocol_id") || !Object.hasOwn(record, "schema") || !Object.hasOwn(record, "rubric_version") ||
      record.protocol_id !== WRITING_9P_PROTOCOL_ID ||
      record.schema !== WRITING_9P_RECORD_SCHEMA ||
      record.rubric_version !== WRITING_9P_RUBRIC_VERSION ||
      (expected.rubricVersion !== undefined && expected.rubricVersion !== WRITING_9P_RUBRIC_VERSION)) {
    return "record_identity_invalid";
  }
  return writingRecordIssue({
    ...record,
    protocol_id: WRITING_PROTOCOL_ID,
    schema: WRITING_RECORD_SCHEMA,
    rubric_version: "latex-writing-quality-rubric-v1",
  }, {
    ...expected,
    rubricVersion: "latex-writing-quality-rubric-v1",
  });
}
