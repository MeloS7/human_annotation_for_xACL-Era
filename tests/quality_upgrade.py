#!/usr/bin/env python3
"""Upgrade a disposable 001 database, preserve alignment data, and exercise quality RPCs."""
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
PROTOCOL = json.loads((ROOT / "site/protocols/document-quality-v1/protocol.json").read_text())
MIGRATION = (ROOT / "supabase/002_document_quality.sql").read_text()
QUALITY_SQL_TEST = (ROOT / "tests/quality_backend.sql").read_text()
PROTOCOL_ID = PROTOCOL["protocol_id"]
STUDY_ID = PROTOCOL["study_id"]
MANIFEST = PROTOCOL["manifest_sha256"]
RECORD_SCHEMA = PROTOCOL["record_schema"]
RUBRIC = PROTOCOL["rubric_version"]
GUIDANCE = PROTOCOL["guidance_version"]
GUIDANCE_SHA256 = PROTOCOL["guidance_sha256"]
RUBRIC_SHA256 = PROTOCOL["rubric_sha256"]
OLD_GUIDANCE = (
    "alignment-guidance-20261024-v4",
    "a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c",
)
OLD_RUBRIC = "alignment-rubric-v1"
OLD_AT = "2026-10-24T12:00:00.000Z"
QUALITY_AT = "2026-10-26T12:00:00.000Z"
VERSION_DIFFERENCES = [
    "text_revision",
    "scientific_content_revision",
    "technical_objects_revision",
    "structure_revision",
    "references_revision",
    "appendix_revision",
    "identity_uncertain",
]

for relative, expected in (
    ("site/protocols/document-quality-v1/rubric.json", RUBRIC_SHA256),
    ("site/protocols/document-quality-v1/guidance.json", GUIDANCE_SHA256),
):
    actual = hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"{relative} hash does not match protocol.json: {actual}")


def legacy_fixture(annotator_id):
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
        "evidence": "Pre-migration eight-score archive fixture.",
        "notes": "Must stay byte-for-byte equivalent as JSON data.",
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


def seed_legacy(conn, annotator_id, user_id, recovery_code):
    record = legacy_fixture(annotator_id)
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
        (STUDY_ID, annotator_id, Jsonb(record), *OLD_GUIDANCE, OLD_AT),
    )
    conn.execute(
        "INSERT INTO xacl_private.annotation_history "
        "(study_id, annotator_id, revision, full_record, guidance_version, guidance_sha256, operation, saved_at) "
        "VALUES (%s, %s, 1, %s, %s, %s, 'save', %s)",
        (STUDY_ID, annotator_id, Jsonb(record), *OLD_GUIDANCE, OLD_AT),
    )
    return record


def legacy_snapshot(conn, annotator_id):
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
    current = conn.execute(
        "SELECT revision, current_record, guidance_version, guidance_sha256, saved_at "
        "FROM xacl_private.annotation_records WHERE study_id=%s AND annotator_id=%s",
        (STUDY_ID, annotator_id),
    ).fetchone()
    history = conn.execute(
        "SELECT history_id, revision, full_record, guidance_version, guidance_sha256, operation, saved_at "
        "FROM xacl_private.annotation_history WHERE study_id=%s AND annotator_id=%s ORDER BY revision",
        (STUDY_ID, annotator_id),
    ).fetchall()
    return participant, sessions, current, history


def migrate(conn):
    # Simple-query mode accepts the migration's transaction and complete
    # SECURITY DEFINER function bodies without splitting on embedded semicolons.
    conn.execute(MIGRATION, prepare=False)


def authenticated_connection(user_id):
    conn = psycopg.connect(dsn, autocommit=True)
    conn.execute("SET ROLE authenticated")
    claims = {
        "sub": str(user_id),
        "role": "authenticated",
        "aud": "authenticated",
        "is_anonymous": True,
    }
    conn.execute(
        "SELECT pg_catalog.set_config('request.jwt.claims', %s, false)",
        (json.dumps(claims),),
    )
    return conn


def call_rpc(conn, name, args=()):
    placeholders = ",".join("%s" for _ in args)
    return conn.execute(f"SELECT public.{name}({placeholders})", args).fetchone()[0]


def quality_blank_record(annotator_id, created_at):
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


def quality_annotation(scores, *, status="completed", reviewed=True, differences=None):
    return {
        "scores": scores,
        "version_differences": list(VERSION_DIFFERENCES if differences is None else differences),
        "version_notes": "",
        "evidence": "",
        "notes": "",
        "reviewed_full_scope": reviewed,
        "status": status,
        "updated_at": QUALITY_AT,
    }


def quality_save_record(annotator_id, created_at):
    all_five = {
        "language_clarity": 5,
        "coherence_flow": 5,
        "structural_completeness": 5,
        "technical_presentation": 5,
        "visual_integrity": 5,
        "overall_quality": 5,
    }
    uncertain_with_na = {
        "language_clarity": "uncertain",
        "coherence_flow": 5,
        "structural_completeness": 5,
        "technical_presentation": "na",
        "visual_integrity": 5,
        "overall_quality": 5,
    }
    record = quality_blank_record(annotator_id, created_at)
    record["annotations"] = {
        "RL01": quality_annotation(all_five),
        "RL02": quality_annotation(uncertain_with_na, differences=[]),
    }
    return record


def assert_quality_blank(result, annotator_id):
    assert "record" in result, result
    record = result["record"]
    assert record["schema"] == RECORD_SCHEMA, record
    assert record["protocol_id"] == PROTOCOL_ID, record
    assert record["annotator_id"] == annotator_id, record
    assert record["revision"] == 0 and record["annotations"] == {}, record
    assert set(record) == {
        "schema", "protocol_id", "dataset_id", "manifest_sha256", "rubric_version",
        "annotator_id", "revision", "created_at", "updated_at", "annotations",
    }, record
    assert record["created_at"] >= "2026-10-26T00:00:00.000Z", record["created_at"]
    return record


def exercise_rpc_contract(annotator_id, recovery_code, original_uid, device_uid, legacy_record, old_snapshot):
    restored_snapshot = None
    with authenticated_connection(original_uid) as conn:
        health = call_rpc(conn, "xacl_quality_annotation_health")
        assert health["ready"] is True, health
        assert health["protocol_id"] == PROTOCOL_ID, health
        assert health["record_schema"] == RECORD_SCHEMA, health
        assert health["rubric_sha256"] == RUBRIC_SHA256, health
        assert health["dataset_id"] == STUDY_ID and health["manifest_sha256"] == MANIFEST, health
        assert health["guidance_version"] == GUIDANCE and health["guidance_sha256"] == GUIDANCE_SHA256, health

        # Re-registering an existing alignment profile must return the fresh
        # quality record and must never expose its archived alignment record.
        current = call_rpc(conn, "xacl_quality_register_annotator", (annotator_id, recovery_code))
        quality_current = assert_quality_blank(current, annotator_id)
        assert "objects" not in json.dumps(current) and "text_alignment" not in json.dumps(current), current

        loaded = call_rpc(conn, "xacl_quality_current_annotations")
        assert loaded["record"] == quality_current, loaded
        loaded_by_id = call_rpc(conn, "xacl_quality_load_annotations", (annotator_id,))
        assert loaded_by_id["record"] == quality_current, loaded_by_id

        # Preserved alignment reads continue to expose exactly the archived row.
        old_read = call_rpc(conn, "xacl_load_annotations", (annotator_id,))
        assert old_read["record"] == legacy_record, old_read
        assert old_read["record"]["schema"] == "revisionlens.alignment-annotations.v1"

        # The legacy save endpoint is revoked after 002, so cached alignment
        # clients cannot overwrite the historical answer set.
        try:
            call_rpc(conn, "xacl_save_annotations", (
                annotator_id, Jsonb(legacy_record), OLD_GUIDANCE[0], OLD_GUIDANCE[1], "save"
            ))
        except psycopg.errors.InsufficientPrivilege:
            pass
        else:
            raise AssertionError("authenticated role could still execute legacy xacl_save_annotations")

        quality_record = quality_save_record(annotator_id, quality_current["created_at"])

    # A recovery-code restore on another anonymous identity returns the same
    # revision-0 quality record and keeps the shared profile binding rules.
    with authenticated_connection(device_uid) as conn:
        resumed = call_rpc(conn, "xacl_quality_resume_annotator", (annotator_id, recovery_code))
        assert assert_quality_blank(resumed, annotator_id) == quality_current
        loaded = call_rpc(conn, "xacl_quality_current_annotations")
        assert loaded["record"] == quality_current, loaded

        # Direct access to the private quality tables is denied even for an
        # authenticated participant with a valid profile binding.
        try:
            conn.execute("SELECT * FROM xacl_private.quality_annotation_records").fetchall()
        except psycopg.errors.InsufficientPrivilege:
            pass
        else:
            raise AssertionError("authenticated role read the private quality records table directly")

    with psycopg.connect(dsn, autocommit=True) as conn:
        restored_snapshot = legacy_snapshot(conn, annotator_id)
    assert restored_snapshot[0] == old_snapshot[0], "recovery changed the legacy participant row"
    assert restored_snapshot[2:] == old_snapshot[2:], "recovery changed archived alignment current/history"
    assert all(session in restored_snapshot[1] for session in old_snapshot[1]), "recovery removed an existing device binding"
    added_sessions = [session for session in restored_snapshot[1] if session[1] == device_uid]
    assert len(added_sessions) == 1, restored_snapshot[1]
    assert len(restored_snapshot[1]) == len(old_snapshot[1]) + 1, restored_snapshot[1]
    assert added_sessions[0][0] == STUDY_ID and added_sessions[0][2] == annotator_id, added_sessions[0]

    outsider_uid = uuid.uuid4()
    with authenticated_connection(outsider_uid) as conn:
        unauthorized = call_rpc(conn, "xacl_quality_load_annotations", (annotator_id,))
        assert unauthorized.get("error") == "invalid_access", unauthorized
        unauthorized = call_rpc(conn, "xacl_quality_save_annotations", (
            annotator_id, Jsonb(quality_record), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert unauthorized.get("error") == "invalid_access", unauthorized

    # Two independently authenticated devices save the same revision at once.
    # Exactly one wins and the other receives the optimistic-concurrency error.
    barrier = threading.Barrier(2)

    def concurrent_save(user_id):
        with authenticated_connection(user_id) as conn:
            barrier.wait(timeout=15)
            return call_rpc(conn, "xacl_quality_save_annotations", (
                annotator_id,
                Jsonb(quality_record),
                GUIDANCE,
                GUIDANCE_SHA256,
                "save",
            ))

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        race_results = list(pool.map(concurrent_save, (original_uid, device_uid)))
    successful = [result for result in race_results if "record" in result]
    conflicts = [result for result in race_results if result.get("error") == "revision_conflict"]
    assert len(successful) == 1 and successful[0]["record"]["revision"] == 1, race_results
    assert len(conflicts) == 1 and conflicts[0]["current_revision"] == 1, race_results
    saved = successful[0]["record"]
    assert saved["annotations"]["RL01"]["scores"]["overall_quality"] == 5, saved
    assert saved["annotations"]["RL01"]["version_differences"] == VERSION_DIFFERENCES, saved
    assert saved["annotations"]["RL01"]["status"] == "completed", saved
    assert saved["annotations"]["RL02"]["scores"]["language_clarity"] == "uncertain", saved
    assert saved["annotations"]["RL02"]["scores"]["technical_presentation"] == "na", saved

    with authenticated_connection(original_uid) as conn:
        stale = copy.deepcopy(quality_record)
        stale_result = call_rpc(conn, "xacl_quality_save_annotations", (
            annotator_id, Jsonb(stale), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert stale_result.get("error") == "revision_conflict", stale_result

        invalid_score = copy.deepcopy(saved)
        invalid_score["annotations"]["RL01"]["scores"]["overall_quality"] = 6
        result = call_rpc(conn, "xacl_quality_save_annotations", (
            annotator_id, Jsonb(invalid_score), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        invalid_na = copy.deepcopy(saved)
        invalid_na["annotations"]["RL01"]["scores"]["visual_integrity"] = "na"
        result = call_rpc(conn, "xacl_quality_save_annotations", (
            annotator_id, Jsonb(invalid_na), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        invalid_keys = copy.deepcopy(saved)
        invalid_keys["unexpected"] = True
        result = call_rpc(conn, "xacl_quality_save_annotations", (
            annotator_id, Jsonb(invalid_keys), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        invalid_flags = copy.deepcopy(saved)
        invalid_flags["annotations"]["RL01"]["version_differences"].append("text_revision")
        result = call_rpc(conn, "xacl_quality_save_annotations", (
            annotator_id, Jsonb(invalid_flags), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        assert result.get("error") == "invalid_record", result

        # Accepted imports are stamped and recorded separately in immutable history.
        imported = copy.deepcopy(saved)
        imported["annotations"]["RL01"]["notes"] = "Imported from a valid quality export."
        result = call_rpc(conn, "xacl_quality_save_annotations", (
            annotator_id, Jsonb(imported), GUIDANCE, GUIDANCE_SHA256, "import"
        ))
        assert "record" in result and result["record"]["revision"] == 2, result
        assert result["record"]["updated_at"] != saved["updated_at"], result

        quality_current = call_rpc(conn, "xacl_quality_current_annotations")["record"]
        assert quality_current["revision"] == 2, quality_current
        assert "text_alignment" not in json.dumps(quality_current)
        legacy_after = call_rpc(conn, "xacl_load_annotations", (annotator_id,))["record"]
        assert legacy_after == legacy_record, legacy_after

    with psycopg.connect(dsn, autocommit=True) as conn:
        history = conn.execute(
            "SELECT protocol_id, revision, full_record, rubric_version, rubric_sha256, "
            "guidance_version, guidance_sha256, operation "
            "FROM xacl_private.quality_annotation_history "
            "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s ORDER BY revision",
            (PROTOCOL_ID, STUDY_ID, annotator_id),
        ).fetchall()
        assert [row[1] for row in history] == [1, 2], history
        assert history[0][7] == "save" and history[1][7] == "import", history
        for row in history:
            assert row[0] == PROTOCOL_ID and row[3:7] == (
                RUBRIC, RUBRIC_SHA256, GUIDANCE, GUIDANCE_SHA256
            ), row
        assert legacy_snapshot(conn, annotator_id) == restored_snapshot, "quality writes changed legacy alignment data or device bindings"

    max_record = copy.deepcopy(quality_current)
    max_record["revision"] = 9007199254740991
    conn = psycopg.connect(dsn, autocommit=True)
    try:
        conn.execute("BEGIN")
        conn.execute(
            "UPDATE xacl_private.quality_annotation_records "
            "SET revision=%s, current_record=%s "
            "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s",
            (max_record["revision"], Jsonb(max_record), PROTOCOL_ID, STUDY_ID, annotator_id),
        )
        conn.execute("SET LOCAL ROLE authenticated")
        claims = {
            "sub": str(original_uid),
            "role": "authenticated",
            "aud": "authenticated",
            "is_anonymous": True,
        }
        conn.execute(
            "SELECT pg_catalog.set_config('request.jwt.claims', %s, true)",
            (json.dumps(claims),),
        )
        exhausted = call_rpc(conn, "xacl_quality_save_annotations", (
            annotator_id, Jsonb(max_record), GUIDANCE, GUIDANCE_SHA256, "save"
        ))
        conn.execute("ROLLBACK")
    finally:
        conn.close()
    assert exhausted.get("error") == "revision_exhausted", exhausted
    with authenticated_connection(original_uid) as conn:
        assert call_rpc(conn, "xacl_quality_current_annotations")["record"]["revision"] == quality_current["revision"]

    conn = psycopg.connect(dsn, autocommit=True)
    try:
        conn.execute("BEGIN")
        conn.execute(
            "UPDATE xacl_private.participants SET revoked_at=pg_catalog.clock_timestamp() "
            "WHERE study_id=%s AND annotator_id=%s",
            (STUDY_ID, annotator_id),
        )
        conn.execute("SET LOCAL ROLE authenticated")
        claims = {
            "sub": str(original_uid),
            "role": "authenticated",
            "aud": "authenticated",
            "is_anonymous": True,
        }
        conn.execute(
            "SELECT pg_catalog.set_config('request.jwt.claims', %s, true)",
            (json.dumps(claims),),
        )
        revoked = call_rpc(conn, "xacl_quality_load_annotations", (annotator_id,))
        conn.execute("ROLLBACK")
    finally:
        conn.close()
    assert revoked.get("error") == "invalid_access", revoked

    return quality_current


with psycopg.connect(dsn, autocommit=True) as conn:
    config = conn.execute(
        "SELECT dataset_id, manifest_sha256, rubric_version, guidance_version, guidance_sha256 "
        "FROM xacl_private.study_config WHERE study_id=%s",
        (STUDY_ID,),
    ).fetchone()
    expected_legacy_config = (
        STUDY_ID, MANIFEST, OLD_RUBRIC, OLD_GUIDANCE[0], OLD_GUIDANCE[1]
    )
    if config != expected_legacy_config:
        raise SystemExit(f"Test database must start from the current 001 config: {config!r}")
    if conn.execute("SELECT pg_catalog.to_regclass('xacl_private.quality_protocol_config')").fetchone()[0] is not None:
        raise SystemExit("Test database already has the quality protocol; use a fresh 001-only database")
    if conn.execute("SELECT pg_catalog.to_regprocedure('public.xacl_quality_annotation_health()')").fetchone()[0] is not None:
        raise SystemExit("Test database already has quality RPCs; use a fresh 001-only database")
    if not conn.execute(
        "SELECT pg_catalog.has_function_privilege('authenticated', "
        "'public.xacl_save_annotations(text,jsonb,text,text,text)', 'EXECUTE')"
    ).fetchone()[0]:
        raise SystemExit("Base 001 database unexpectedly revoked the original alignment save RPC")

    annotator_id = "QA_QUALITY_" + uuid.uuid4().hex[:12]
    recovery_code = "c" * 64
    original_uid, device_uid = uuid.uuid4(), uuid.uuid4()
    legacy_record = seed_legacy(conn, annotator_id, original_uid, recovery_code)
    old_snapshot = legacy_snapshot(conn, annotator_id)
    if old_snapshot[2] is None or len(old_snapshot[3]) != 1:
        raise SystemExit("Could not establish the pre-migration legacy current/history fixture")

    migrate(conn)
    if legacy_snapshot(conn, annotator_id) != old_snapshot:
        raise SystemExit("002 changed an existing participant binding, alignment row, or alignment history")
    if conn.execute("SELECT pg_catalog.has_function_privilege('authenticated', "
                    "'public.xacl_save_annotations(text,jsonb,text,text,text)', 'EXECUTE')").fetchone()[0]:
        raise SystemExit("002 did not revoke authenticated execution of the legacy alignment save RPC")

    # Reapplying 002 must preserve the new config and all pre-existing legacy data.
    migrate(conn)
    if legacy_snapshot(conn, annotator_id) != old_snapshot:
        raise SystemExit("reapplying 002 changed a legacy participant binding or archived alignment answer")

    conn.execute(QUALITY_SQL_TEST, prepare=False)

quality_record = exercise_rpc_contract(
    annotator_id, recovery_code, original_uid, device_uid, legacy_record, old_snapshot
)

fresh_annotator = "QA_QUALITY_NEW_" + uuid.uuid4().hex[:10]
fresh_code = "d" * 64
fresh_uid, restored_uid = uuid.uuid4(), uuid.uuid4()
with authenticated_connection(fresh_uid) as conn:
    registered = call_rpc(conn, "xacl_quality_register_annotator", (fresh_annotator, fresh_code))
    fresh_record = assert_quality_blank(registered, fresh_annotator)
with authenticated_connection(restored_uid) as conn:
    restored = call_rpc(conn, "xacl_quality_resume_annotator", (fresh_annotator, fresh_code))
    assert assert_quality_blank(restored, fresh_annotator) == fresh_record

print(
    "PASS: 002 is idempotent; legacy alignment records remain unchanged; quality wrappers, "
    "isolation, validation, history, recovery, and concurrent revision conflicts work."
)
