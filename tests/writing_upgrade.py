#!/usr/bin/env python3
"""Apply migration 003 on an isolated 001+002 DB and test protocol isolation."""
import concurrent.futures
import copy
import hashlib
import json
import os
import threading
import uuid
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb


if os.environ.get("XACL_DISPOSABLE_DATABASE") != "1":
    raise SystemExit("Set XACL_DISPOSABLE_DATABASE=1 only for an isolated test database")
dsn = os.environ.get("QA_DATABASE_URL", "")
if not dsn:
    raise SystemExit("QA_DATABASE_URL is required")

ROOT = Path(__file__).resolve().parents[1]
WRITING = json.loads((ROOT / "site/protocols/latex-writing-quality-v1/protocol.json").read_text())
DOCUMENT = json.loads((ROOT / "site/protocols/document-quality-v1/protocol.json").read_text())
MIGRATION = (ROOT / "supabase/003_latex_writing.sql").read_text()
SQL_TEST = (ROOT / "tests/writing_backend.sql").read_text()
PROTOCOL_ID = WRITING["protocol_id"]
STUDY_ID = WRITING["study_id"]
MANIFEST = WRITING["manifest_sha256"]
RECORD_SCHEMA = WRITING["record_schema"]
RUBRIC = WRITING["rubric_version"]
RUBRIC_SHA256 = WRITING["rubric_sha256"]
GUIDANCE = WRITING["guidance_version"]
GUIDANCE_SHA256 = WRITING["guidance_sha256"]
DOC_PROTOCOL_ID = DOCUMENT["protocol_id"]
DOC_RECORD_SCHEMA = DOCUMENT["record_schema"]
DOC_RUBRIC = DOCUMENT["rubric_version"]
DOC_RUBRIC_SHA256 = DOCUMENT["rubric_sha256"]
DOC_GUIDANCE = DOCUMENT["guidance_version"]
DOC_GUIDANCE_SHA256 = DOCUMENT["guidance_sha256"]
OLD_RUBRIC = "alignment-rubric-v1"
OLD_GUIDANCE = (
    "alignment-guidance-20261024-v4",
    "a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c",
)
OLD_AT = "2026-10-24T12:00:00.000Z"
QUALITY_AT = "2026-10-26T12:00:00.000Z"
VERSION_DIFFERENCES = list(WRITING["version_difference_keys"])
ISSUE_CODES = list(WRITING["visual_issue_keys"])
CORE_KEYS = list(WRITING["score_keys"])

for relative, expected in (
    ("site/protocols/latex-writing-quality-v1/rubric.json", RUBRIC_SHA256),
    ("site/protocols/latex-writing-quality-v1/guidance.json", GUIDANCE_SHA256),
):
    actual = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"{relative} hash does not match protocol.json: {actual}")


def legacy_alignment_record(annotator_id):
    annotation = {
        "scores": {
            "text_alignment": 4,
            "figure_alignment": 4,
            "table_alignment": "na",
            "equation_alignment": 4,
            "structure_alignment": 4,
            "content_coverage": 4,
            "overall_alignment": 4,
            "visual_integrity": 4,
        },
        "objects": {
            "figure": {"compiled": "present", "official": "present"},
            "table": {"compiled": "absent", "official": "absent"},
            "equation": {"compiled": "present", "official": "present"},
        },
        "evidence": "Pre-003 legacy alignment fixture.",
        "notes": "Must remain in the original archive.",
        "flags": [],
        "reviewed_full_scope": True,
        "status": "completed",
        "updated_at": OLD_AT,
    }
    return {
        "schema": "revisionlens.alignment-annotations.v1",
        "dataset_id": STUDY_ID,
        "manifest_sha256": MANIFEST,
        "rubric_version": OLD_RUBRIC,
        "annotator_id": annotator_id,
        "revision": 1,
        "created_at": OLD_AT,
        "updated_at": OLD_AT,
        "annotations": {"RL01": annotation},
    }


def document_quality_record(annotator_id):
    annotation = {
        "scores": {
            "language_clarity": 4,
            "coherence_flow": 4,
            "structural_completeness": 4,
            "technical_presentation": 4,
            "visual_integrity": 4,
            "overall_quality": 4,
        },
        "version_differences": [],
        "version_notes": "",
        "evidence": "",
        "notes": "Prior document-quality fixture.",
        "reviewed_full_scope": True,
        "status": "completed",
        "updated_at": OLD_AT,
    }
    return {
        "schema": DOC_RECORD_SCHEMA,
        "protocol_id": DOC_PROTOCOL_ID,
        "dataset_id": STUDY_ID,
        "manifest_sha256": MANIFEST,
        "rubric_version": DOC_RUBRIC,
        "annotator_id": annotator_id,
        "revision": 1,
        "created_at": OLD_AT,
        "updated_at": OLD_AT,
        "annotations": {"RL01": annotation},
    }


def seed_archives(conn, annotator_id, user_id, recovery_code):
    alignment = legacy_alignment_record(annotator_id)
    document = document_quality_record(annotator_id)
    conn.execute(
        "INSERT INTO xacl_private.participants "
        "(study_id, annotator_id, recovery_code_sha256, created_at) "
        "VALUES (%s, %s, extensions.digest(pg_catalog.convert_to(%s, 'UTF8'), 'sha256'), %s)",
        (STUDY_ID, annotator_id, recovery_code, OLD_AT),
    )
    conn.execute(
        "INSERT INTO xacl_private.participant_sessions (study_id, user_id, annotator_id, created_at) "
        "VALUES (%s, %s, %s, %s)",
        (STUDY_ID, user_id, annotator_id, OLD_AT),
    )
    conn.execute(
        "INSERT INTO xacl_private.annotation_records "
        "(study_id, annotator_id, revision, current_record, guidance_version, guidance_sha256, saved_at) "
        "VALUES (%s, %s, 1, %s, %s, %s, %s)",
        (STUDY_ID, annotator_id, Jsonb(alignment), *OLD_GUIDANCE, OLD_AT),
    )
    conn.execute(
        "INSERT INTO xacl_private.annotation_history "
        "(study_id, annotator_id, revision, full_record, guidance_version, guidance_sha256, operation, saved_at) "
        "VALUES (%s, %s, 1, %s, %s, %s, 'save', %s)",
        (STUDY_ID, annotator_id, Jsonb(alignment), *OLD_GUIDANCE, OLD_AT),
    )
    conn.execute(
        "INSERT INTO xacl_private.quality_annotation_records "
        "(protocol_id, study_id, annotator_id, revision, current_record, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256, saved_at) "
        "VALUES (%s, %s, %s, 1, %s, %s, %s, %s, %s, %s)",
        (
            DOC_PROTOCOL_ID, STUDY_ID, annotator_id, Jsonb(document),
            DOC_RUBRIC, DOC_RUBRIC_SHA256, DOC_GUIDANCE, DOC_GUIDANCE_SHA256, OLD_AT,
        ),
    )
    conn.execute(
        "INSERT INTO xacl_private.quality_annotation_history "
        "(protocol_id, study_id, annotator_id, revision, full_record, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256, operation, saved_at) "
        "VALUES (%s, %s, %s, 1, %s, %s, %s, %s, %s, 'save', %s)",
        (
            DOC_PROTOCOL_ID, STUDY_ID, annotator_id, Jsonb(document),
            DOC_RUBRIC, DOC_RUBRIC_SHA256, DOC_GUIDANCE, DOC_GUIDANCE_SHA256, OLD_AT,
        ),
    )
    return alignment, document


def archive_snapshot(conn, annotator_id):
    participant = conn.execute(
        "SELECT study_id, annotator_id, recovery_code_sha256, revoked_at, created_at "
        "FROM xacl_private.participants WHERE study_id=%s AND annotator_id=%s",
        (STUDY_ID, annotator_id),
    ).fetchone()
    sessions = conn.execute(
        "SELECT study_id, user_id, annotator_id, created_at "
        "FROM xacl_private.participant_sessions WHERE study_id=%s AND annotator_id=%s ORDER BY user_id",
        (STUDY_ID, annotator_id),
    ).fetchall()
    alignment_current = conn.execute(
        "SELECT revision, current_record, guidance_version, guidance_sha256, saved_at "
        "FROM xacl_private.annotation_records WHERE study_id=%s AND annotator_id=%s",
        (STUDY_ID, annotator_id),
    ).fetchone()
    alignment_history = conn.execute(
        "SELECT history_id, revision, full_record, guidance_version, guidance_sha256, operation, saved_at "
        "FROM xacl_private.annotation_history WHERE study_id=%s AND annotator_id=%s ORDER BY revision",
        (STUDY_ID, annotator_id),
    ).fetchall()
    document_current = conn.execute(
        "SELECT protocol_id, revision, current_record, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256, saved_at "
        "FROM xacl_private.quality_annotation_records "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s",
        (DOC_PROTOCOL_ID, STUDY_ID, annotator_id),
    ).fetchone()
    document_history = conn.execute(
        "SELECT history_id, protocol_id, revision, full_record, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256, operation, saved_at "
        "FROM xacl_private.quality_annotation_history "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s ORDER BY revision",
        (DOC_PROTOCOL_ID, STUDY_ID, annotator_id),
    ).fetchall()
    document_config = conn.execute(
        "SELECT protocol_id, study_id, dataset_id, manifest_sha256, record_schema, rubric_version, "
        "rubric_sha256, guidance_version, guidance_sha256, created_at "
        "FROM xacl_private.quality_protocol_config WHERE protocol_id=%s",
        (DOC_PROTOCOL_ID,),
    ).fetchone()
    return (
        participant, sessions, alignment_current, alignment_history,
        document_current, document_history, document_config,
    )


def migrate(conn):
    # Simple-query mode supports the explicit migration transaction and
    # SECURITY DEFINER bodies with embedded semicolons.
    conn.execute(MIGRATION, prepare=False)


def auth_connection(user_id):
    conn = psycopg.connect(dsn, autocommit=True)
    conn.execute("SET ROLE authenticated")
    claims = {
        "sub": str(user_id), "role": "authenticated", "aud": "authenticated", "is_anonymous": True,
    }
    conn.execute(
        "SELECT pg_catalog.set_config('request.jwt.claims', %s, false)",
        (json.dumps(claims),),
    )
    return conn


def rpc(conn, name, args=()):
    placeholders = ",".join("%s" for _ in args)
    return conn.execute(f"SELECT public.{name}({placeholders})", args).fetchone()[0]


def blank_record(annotator_id, created_at):
    return {
        "schema": RECORD_SCHEMA,
        "protocol_id": PROTOCOL_ID,
        "dataset_id": STUDY_ID,
        "manifest_sha256": MANIFEST,
        "rubric_version": RUBRIC,
        "annotator_id": annotator_id,
        "revision": 0,
        "created_at": created_at,
        "updated_at": created_at,
        "annotations": {},
    }


def writing_annotation(scores, *, status="completed", reviewed=True, reference_exposed=False, auxiliary=None, differences=None):
    if auxiliary is None:
        auxiliary = {"status": "not_assessed", "score": None, "issue_codes": []}
    return {
        "scores": scores,
        "auxiliary_checks": {"pdf_visual_integrity": auxiliary},
        "version_differences": list(VERSION_DIFFERENCES if differences is None else differences),
        "version_notes": "",
        "reference_exposed": reference_exposed,
        "reviewed_full_scope": reviewed,
        "status": status,
        "updated_at": QUALITY_AT,
    }


def complete_record(annotator_id, created_at):
    all_five = {key: 5 for key in CORE_KEYS}
    with_uncertain = dict(all_five)
    with_uncertain["technical_expression"] = "uncertain"
    record = blank_record(annotator_id, created_at)
    record["annotations"] = {
        "RL01": writing_annotation(
            all_five,
            auxiliary={"status": "assessed", "score": 1, "issue_codes": ["clipping"]},
        ),
        "RL02": writing_annotation(
            with_uncertain,
            auxiliary={"status": "not_assessed", "score": None, "issue_codes": []},
            differences=[],
        ),
    }
    return record


def draft_record(annotator_id, created_at):
    return {
        "RL01": writing_annotation(
            {key: None for key in CORE_KEYS},
            status="draft", reviewed=False, differences=[],
        )
    }


def blank_from_response(result, annotator_id):
    assert "record" in result, result
    record = result["record"]
    assert record["schema"] == RECORD_SCHEMA and record["protocol_id"] == PROTOCOL_ID, record
    assert record["annotator_id"] == annotator_id and record["revision"] == 0, record
    assert record["annotations"] == {}, record
    assert set(record) == set(WRITING["record_keys"]), record
    assert record["created_at"] >= "2026-10-26T00:00:00.000Z", record
    return record


def test_rpc_behavior(annotator_id, recovery_code, original_uid, device_uid, old_alignment, old_document, prewrite_snapshot):
    with auth_connection(original_uid) as conn:
        health = rpc(conn, "xacl_writing_annotation_health")
        assert health["ready"] is True, health
        assert health["protocol_id"] == PROTOCOL_ID and health["record_schema"] == RECORD_SCHEMA, health
        assert health["rubric_sha256"] == RUBRIC_SHA256, health
        assert health["dataset_id"] == STUDY_ID and health["manifest_sha256"] == MANIFEST, health
        assert health["guidance_version"] == GUIDANCE and health["guidance_sha256"] == GUIDANCE_SHA256, health

        registered = rpc(conn, "xacl_writing_register_annotator", (annotator_id, recovery_code))
        current = blank_from_response(registered, annotator_id)
        assert "text_alignment" not in json.dumps(registered)
        assert "technical_presentation" not in json.dumps(registered)
        assert rpc(conn, "xacl_writing_current_annotations")["record"] == current
        assert rpc(conn, "xacl_writing_load_annotations", (annotator_id,))["record"] == current

        # Both old read paths still reach their own frozen records, while all
        # three old write paths are revoked after migration 003.
        assert rpc(conn, "xacl_load_annotations", (annotator_id,))["record"] == old_alignment
        assert rpc(conn, "xacl_quality_load_annotations", (annotator_id,))["record"] == old_document
        for old_rpc, args in (
            ("xacl_save_annotations", (annotator_id, Jsonb(old_alignment), OLD_GUIDANCE[0], OLD_GUIDANCE[1], "save")),
            ("xacl_quality_save_annotations", (annotator_id, Jsonb(old_document), DOC_GUIDANCE, DOC_GUIDANCE_SHA256, "save")),
        ):
            try:
                rpc(conn, old_rpc, args)
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError(f"authenticated role can still execute archived write RPC {old_rpc}")

        writing = complete_record(annotator_id, current["created_at"])
        alignment_payload = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(old_alignment), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert alignment_payload.get("error") == "invalid_record", alignment_payload
        document_payload = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(old_document), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert document_payload.get("error") == "study_mismatch", document_payload

        wrong_protocol = copy.deepcopy(writing)
        wrong_protocol["protocol_id"] = DOC_PROTOCOL_ID
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(wrong_protocol), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "study_mismatch", result
        wrong_schema = copy.deepcopy(writing)
        wrong_schema["schema"] = DOC_RECORD_SCHEMA
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(wrong_schema), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "study_mismatch", result

        # A legacy six-score payload cannot be interpreted as five writing scores.
        legacy_six = copy.deepcopy(old_document)
        legacy_six["schema"] = RECORD_SCHEMA
        legacy_six["protocol_id"] = PROTOCOL_ID
        legacy_six["rubric_version"] = RUBRIC
        legacy_six["annotations"]["RL01"]["scores"]["unexpected_old_score"] = 4
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(legacy_six), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        invalid_na = copy.deepcopy(writing)
        invalid_na["annotations"]["RL01"]["scores"]["technical_expression"] = "na"
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(invalid_na), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        invalid_nested = copy.deepcopy(writing)
        invalid_nested["annotations"]["RL01"]["auxiliary_checks"]["pdf_visual_integrity"]["status"] = "unknown"
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(invalid_nested), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        invalid_issue = copy.deepcopy(writing)
        invalid_issue["annotations"]["RL01"]["auxiliary_checks"]["pdf_visual_integrity"]["issue_codes"] = ["future_issue"]
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(invalid_issue), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

    # Restoring on a second anonymous identity adds a legitimate session only;
    # it cannot access either old protocol payload through writing RPCs.
    with auth_connection(device_uid) as conn:
        resumed = rpc(conn, "xacl_writing_resume_annotator", (annotator_id, recovery_code))
        assert blank_from_response(resumed, annotator_id) == current
        assert rpc(conn, "xacl_writing_current_annotations")["record"] == current
        try:
            conn.execute("SELECT * FROM xacl_private.quality_annotation_records").fetchall()
        except psycopg.errors.InsufficientPrivilege:
            pass
        else:
            raise AssertionError("authenticated role directly read private quality records")

    with psycopg.connect(dsn, autocommit=True) as conn:
        restored_snapshot = archive_snapshot(conn, annotator_id)
    assert restored_snapshot[0] == prewrite_snapshot[0], "recovery changed the participant or credential digest"
    assert restored_snapshot[2:] == prewrite_snapshot[2:], "migration/recovery changed old alignment/document-quality rows"
    assert all(session in restored_snapshot[1] for session in prewrite_snapshot[1]), "recovery removed an existing profile binding"
    added = [session for session in restored_snapshot[1] if session[1] == device_uid]
    assert len(added) == 1 and len(restored_snapshot[1]) == len(prewrite_snapshot[1]) + 1, restored_snapshot[1]
    assert added[0][0] == STUDY_ID and added[0][2] == annotator_id, added[0]

    outsider_uid = uuid.uuid4()
    with auth_connection(outsider_uid) as conn:
        denied = rpc(conn, "xacl_writing_load_annotations", (annotator_id,))
        assert denied.get("error") == "invalid_access", denied
        denied = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(writing), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert denied.get("error") == "invalid_access", denied

    # Concurrent first writes from the two restored devices serialize and give
    # exactly one revision-1 response plus one optimistic conflict.
    barrier = threading.Barrier(2)

    def save_first_revision(user_id):
        with auth_connection(user_id) as conn:
            barrier.wait(timeout=15)
            return rpc(conn, "xacl_writing_save_annotations", (
                annotator_id, Jsonb(writing), GUIDANCE, GUIDANCE_SHA256, "save"
            ))

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        race = list(pool.map(save_first_revision, (original_uid, device_uid)))
    wins = [result for result in race if "record" in result]
    conflicts = [result for result in race if result.get("error") == "revision_conflict"]
    assert len(wins) == 1 and wins[0]["record"]["revision"] == 1, race
    assert len(conflicts) == 1 and conflicts[0]["current_revision"] == 1, race
    saved = wins[0]["record"]
    assert saved["annotations"]["RL01"]["scores"] == {key: 5 for key in CORE_KEYS}, saved
    assert saved["annotations"]["RL01"]["version_differences"] == VERSION_DIFFERENCES, saved
    assert saved["annotations"]["RL01"]["auxiliary_checks"]["pdf_visual_integrity"]["score"] == 1, saved
    assert saved["annotations"]["RL02"]["scores"]["technical_expression"] == "uncertain", saved

    with auth_connection(original_uid) as conn:
        # The second revision changes only auxiliary PDF results. Completed core
        # scores and status remain valid and unchanged.
        auxiliary_only = copy.deepcopy(saved)
        auxiliary_only["annotations"]["RL01"]["auxiliary_checks"]["pdf_visual_integrity"] = {
            "status": "assessed", "score": 4, "issue_codes": ["overlap"],
        }
        auxiliary_saved = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(auxiliary_only), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert "record" in auxiliary_saved and auxiliary_saved["record"]["revision"] == 2, auxiliary_saved
        assert auxiliary_saved["record"]["annotations"]["RL01"]["status"] == "completed", auxiliary_saved
        assert auxiliary_saved["record"]["annotations"]["RL01"]["scores"] == saved["annotations"]["RL01"]["scores"], auxiliary_saved

        exposed = copy.deepcopy(auxiliary_saved["record"])
        exposed["annotations"]["RL01"]["reference_exposed"] = True
        exposed_result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(exposed), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert "record" in exposed_result and exposed_result["record"]["revision"] == 3, exposed_result
        assert exposed_result["record"]["annotations"]["RL01"]["reference_exposed"] is True, exposed_result

        # Core edits after reference exposure retain the true flag.
        core_edit = copy.deepcopy(exposed_result["record"])
        core_edit["annotations"]["RL01"]["scores"]["language_clarity"] = 4
        core_edit_result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(core_edit), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert "record" in core_edit_result and core_edit_result["record"]["revision"] == 4, core_edit_result
        assert core_edit_result["record"]["annotations"]["RL01"]["reference_exposed"] is True, core_edit_result

        reset = copy.deepcopy(core_edit_result["record"])
        reset["annotations"]["RL01"]["reference_exposed"] = False
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(reset), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        removed = copy.deepcopy(core_edit_result["record"])
        del removed["annotations"]["RL01"]
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(removed), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        stale = copy.deepcopy(writing)
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(stale), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "revision_conflict", result

        imported = copy.deepcopy(core_edit_result["record"])
        imported["annotations"]["RL01"]["version_notes"] = "Imported writing notes."
        result = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(imported), GUIDANCE, GUIDANCE_SHA256, "import"
        ))
        assert "record" in result and result["record"]["revision"] == 5, result
        assert result["record"]["annotations"]["RL01"]["reference_exposed"] is True, result
        final_record = result["record"]

    # Safe revision exhaustion is rejected without persisting the test's
    # temporary database state.
    max_record = copy.deepcopy(final_record)
    max_record["revision"] = 9007199254740991
    conn = psycopg.connect(dsn, autocommit=True)
    try:
        conn.execute("BEGIN")
        conn.execute(
            "UPDATE xacl_private.quality_annotation_records SET revision=%s, current_record=%s "
            "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s",
            (max_record["revision"], Jsonb(max_record), PROTOCOL_ID, STUDY_ID, annotator_id),
        )
        conn.execute("SET LOCAL ROLE authenticated")
        claims = {"sub": str(original_uid), "role": "authenticated", "aud": "authenticated", "is_anonymous": True}
        conn.execute("SELECT pg_catalog.set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
        exhausted = rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(max_record), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        conn.execute("ROLLBACK")
    finally:
        conn.close()
    assert exhausted.get("error") == "revision_exhausted", exhausted

    with psycopg.connect(dsn, autocommit=True) as conn:
        final_archive = archive_snapshot(conn, annotator_id)
        assert final_archive == restored_snapshot, "writing saves changed legacy/document-quality archives or profile bindings"
        writing_history = conn.execute(
            "SELECT revision, full_record, rubric_version, rubric_sha256, guidance_version, guidance_sha256, operation "
            "FROM xacl_private.quality_annotation_history "
            "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s ORDER BY revision",
            (PROTOCOL_ID, STUDY_ID, annotator_id),
        ).fetchall()
        assert [row[0] for row in writing_history] == [1, 2, 3, 4, 5], writing_history
        assert writing_history[-1][6] == "import", writing_history[-1]
        for row in writing_history:
            assert row[2:6] == (RUBRIC, RUBRIC_SHA256, GUIDANCE, GUIDANCE_SHA256), row

    # A second, new shared profile checks register/resume and concurrent first
    # saves without relying on the pre-existing archived participant fixture.
    race_annotator = "QA_WRITING_RACE_" + uuid.uuid4().hex[:10]
    race_code = "e" * 64
    race_uid_a, race_uid_b = uuid.uuid4(), uuid.uuid4()
    with auth_connection(race_uid_a) as conn:
        race_blank = blank_from_response(
            rpc(conn, "xacl_writing_register_annotator", (race_annotator, race_code)),
            race_annotator,
        )
    with auth_connection(race_uid_b) as conn:
        assert blank_from_response(
            rpc(conn, "xacl_writing_resume_annotator", (race_annotator, race_code)),
            race_annotator,
        ) == race_blank

    race_record = blank_record(race_annotator, race_blank["created_at"])
    race_record["annotations"] = draft_record(race_annotator, race_blank["created_at"])
    race_barrier = threading.Barrier(2)

    def save_race_revision(user_id):
        with auth_connection(user_id) as conn:
            race_barrier.wait(timeout=15)
            return rpc(conn, "xacl_writing_save_annotations", (
                race_annotator, Jsonb(race_record), GUIDANCE, GUIDANCE_SHA256, "save"
            ))

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        race_results = list(pool.map(save_race_revision, (race_uid_a, race_uid_b)))
    race_wins = [result for result in race_results if "record" in result]
    race_conflicts = [result for result in race_results if result.get("error") == "revision_conflict"]
    assert len(race_wins) == 1 and race_wins[0]["record"]["revision"] == 1, race_results
    assert len(race_conflicts) == 1 and race_conflicts[0]["current_revision"] == 1, race_results
    with psycopg.connect(dsn, autocommit=True) as conn:
        race_history_count = conn.execute(
            "SELECT pg_catalog.count(*) FROM xacl_private.quality_annotation_history "
            "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s",
            (PROTOCOL_ID, STUDY_ID, race_annotator),
        ).fetchone()[0]
    assert race_history_count == 1, race_history_count


with psycopg.connect(dsn, autocommit=True) as conn:
    study = conn.execute(
        "SELECT dataset_id, manifest_sha256, rubric_version, guidance_version, guidance_sha256 "
        "FROM xacl_private.study_config WHERE study_id=%s",
        (STUDY_ID,),
    ).fetchone()
    expected_study = (
        STUDY_ID, MANIFEST, OLD_RUBRIC, OLD_GUIDANCE[0], OLD_GUIDANCE[1]
    )
    if study != expected_study:
        raise SystemExit(f"Test database must have the current frozen cohort config: {study!r}")
    doc_config = conn.execute(
        "SELECT study_id, dataset_id, manifest_sha256, record_schema, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256 FROM xacl_private.quality_protocol_config WHERE protocol_id=%s",
        (DOC_PROTOCOL_ID,),
    ).fetchone()
    expected_doc_config = (
        STUDY_ID, STUDY_ID, MANIFEST, DOCUMENT["record_schema"], DOC_RUBRIC,
        DOC_RUBRIC_SHA256, DOC_GUIDANCE, DOC_GUIDANCE_SHA256,
    )
    if doc_config != expected_doc_config:
        raise SystemExit(f"Test database must have the frozen document-quality protocol: {doc_config!r}")
    if conn.execute(
        "SELECT pg_catalog.to_regclass('xacl_private.quality_protocol_config')"
    ).fetchone()[0] is None:
        raise SystemExit("002 multi-protocol quality tables are required before 003")
    if conn.execute(
        "SELECT pg_catalog.to_regclass('xacl_private.quality_annotation_records')"
    ).fetchone()[0] is None:
        raise SystemExit("002 multi-protocol quality tables are required before 003")
    if conn.execute(
        "SELECT pg_catalog.to_regclass('xacl_private.quality_annotation_history')"
    ).fetchone()[0] is None:
        raise SystemExit("002 multi-protocol quality tables are required before 003")
    if conn.execute(
        "SELECT pg_catalog.to_regprocedure('public.xacl_writing_annotation_health()')"
    ).fetchone()[0] is not None:
        raise SystemExit("Test database already has writing RPCs; use a fresh 001+002 database")
    if conn.execute(
        "SELECT 1 FROM xacl_private.quality_protocol_config WHERE protocol_id=%s",
        (PROTOCOL_ID,),
    ).fetchone() is not None:
        raise SystemExit("Test database already has the writing config row; use a fresh 001+002 database")

    annotator_id = "QA_WRITING_" + uuid.uuid4().hex[:12]
    recovery_code = "c" * 64
    original_uid, device_uid = uuid.uuid4(), uuid.uuid4()
    legacy_record, document_record = seed_archives(conn, annotator_id, original_uid, recovery_code)
    before = archive_snapshot(conn, annotator_id)
    if before[2] is None or len(before[3]) != 1 or before[4] is None or len(before[5]) != 1:
        raise SystemExit("Could not establish both pre-003 protocol current/history fixtures")

    migrate(conn)
    if archive_snapshot(conn, annotator_id) != before:
        raise SystemExit("003 changed a pre-existing profile, alignment archive, or document-quality archive")
    migrate(conn)
    if archive_snapshot(conn, annotator_id) != before:
        raise SystemExit("reapplying 003 changed a pre-existing profile or either old protocol archive")
    conn.execute(SQL_TEST, prepare=False)

test_rpc_behavior(
    annotator_id, recovery_code, original_uid, device_uid,
    legacy_record, document_record, before,
)

print(
    "PASS: 003 is idempotent; alignment/document-quality archives remain unchanged; "
    "writing validation, recovery, monotonic exposure, history, isolation, and concurrency pass."
)
