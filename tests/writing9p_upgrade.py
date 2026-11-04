#!/usr/bin/env python3
"""Install/test the additive 9-page protocol after 001+002+003 on disposable PostgreSQL."""
from __future__ import annotations

import copy
import concurrent.futures
import datetime as dt
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
DSN = os.environ.get("QA_DATABASE_URL", "")
if not DSN:
    raise SystemExit("QA_DATABASE_URL is required")

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_DIR = ROOT / "site/protocols/latex-writing-quality-9p-v1"
CONTRACT = json.loads((PROTOCOL_DIR / "protocol.json").read_text())
RUBRIC_BYTES = (PROTOCOL_DIR / "rubric.json").read_bytes()
GUIDANCE_BYTES = (PROTOCOL_DIR / "guidance.json").read_bytes()
MIGRATION = (ROOT / "supabase/004_writing9p.sql").read_text()
SECURITY_SQL = (ROOT / "tests/writing9p_backend.sql").read_text()

PROTOCOL_ID = "latex-writing-quality-9p-v1"
SCHEMA = "xacl.latex-writing-9p-annotations.v1"
RUBRIC = "latex-writing-quality-9p-rubric-v1"
GUIDANCE = "latex-writing-quality-9p-guidance-20261104-v1"
DATASET_ID = "revisionlens-alignment30-v1"
MANIFEST = "d60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071"
OLD_PROTOCOL_ID = "latex-writing-quality-v1"
OLD_GUIDANCE = "latex-writing-quality-guidance-20261026-v1"
OLD_GUIDANCE_SHA = "7d7a76a2ba140306843b3d955c73f095b083a0938ecd4f5b20cc3494c46b6ce6"
OLD_RUBRIC = "latex-writing-quality-rubric-v1"
OLD_RUBRIC_SHA = "a5a6696e57bc70720c8305b2a1e530de892e203d3c951e09c4cd20ec8b430dfa"
SCORE_KEYS = [
    "language_clarity", "coherence_flow", "structural_completeness",
    "technical_expression", "overall_writing_quality",
]


def rpc(conn, name, args=()):
    placeholders = ",".join("%s" for _ in args)
    return conn.execute(f"SELECT public.{name}({placeholders})", args).fetchone()[0]


def auth_connection(user_id):
    conn = psycopg.connect(DSN, autocommit=True)
    conn.execute("SET ROLE authenticated")
    claims = {"sub": str(user_id), "role": "authenticated", "aud": "authenticated", "is_anonymous": True}
    conn.execute("SELECT pg_catalog.set_config('request.jwt.claims', %s, false)", (json.dumps(claims),))
    return conn


def snapshot_v1(conn):
    config = conn.execute(
        "SELECT protocol_id, study_id, dataset_id, manifest_sha256, record_schema, rubric_version, "
        "rubric_sha256, guidance_version, guidance_sha256, created_at "
        "FROM xacl_private.quality_protocol_config WHERE protocol_id=%s",
        (OLD_PROTOCOL_ID,),
    ).fetchone()
    records = conn.execute(
        "SELECT study_id, annotator_id, revision, current_record, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256, saved_at FROM xacl_private.quality_annotation_records "
        "WHERE protocol_id=%s ORDER BY study_id, annotator_id",
        (OLD_PROTOCOL_ID,),
    ).fetchall()
    history = conn.execute(
        "SELECT study_id, annotator_id, revision, full_record, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256, operation, saved_at FROM xacl_private.quality_annotation_history "
        "WHERE protocol_id=%s ORDER BY study_id, annotator_id, revision",
        (OLD_PROTOCOL_ID,),
    ).fetchall()
    # Participant identities and device/session bindings are shared across the
    # versioned protocols. Migration 004 must not rewrite either, even when it
    # adds the new protocol's blank per-identity records.
    participants = conn.execute(
        "SELECT study_id, annotator_id, recovery_code_sha256, revoked_at, created_at "
        "FROM xacl_private.participants WHERE study_id=%s ORDER BY annotator_id",
        (DATASET_ID,),
    ).fetchall()
    sessions = conn.execute(
        "SELECT study_id, user_id, annotator_id, created_at "
        "FROM xacl_private.participant_sessions WHERE study_id=%s ORDER BY user_id",
        (DATASET_ID,),
    ).fetchall()
    return config, records, history, participants, sessions


def migration(conn):
    conn.execute(MIGRATION, prepare=False)


def assert_prerequisite_failure(ddl, expected_name):
    """Temporarily remove one migration helper and prove 004 fails closed atomically."""
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("BEGIN")
        try:
            conn.execute(ddl)
            try:
                migration(conn)
            except psycopg.Error as exc:
                message = exc.diag.message_primary or ""
                hint = exc.diag.message_hint or ""
                assert exc.sqlstate == "55000", (exc.sqlstate, message)
                assert expected_name in message, message
                assert "migrations 001, 002, and 003" in hint, hint
            else:
                raise AssertionError(f"migration 004 must reject missing prerequisite {expected_name}")
        finally:
            # The failing migration leaves this test transaction aborted; rollback
            # restores the renamed helper and discards all temporary DDL.
            conn.execute("ROLLBACK")


def test_assets_match_contract():
    assert CONTRACT["protocol_id"] == PROTOCOL_ID
    assert CONTRACT["record_schema"] == SCHEMA
    assert CONTRACT["rubric_version"] == RUBRIC
    assert CONTRACT["guidance_version"] == GUIDANCE
    assert hashlib.sha256(RUBRIC_BYTES).hexdigest() == CONTRACT["rubric_sha256"]
    assert hashlib.sha256(GUIDANCE_BYTES).hexdigest() == CONTRACT["guidance_sha256"]
    assert len(CONTRACT["score_keys"]) == 5
    assert CONTRACT["scope_policy"]["first_page"] == 1
    assert CONTRACT["scope_policy"]["last_page_inclusive"] == 9
    assert "__NINEPAGE_" not in MIGRATION


test_assets_match_contract()

with psycopg.connect(DSN, autocommit=True) as conn:
    existing = conn.execute(
        "SELECT rubric_version, rubric_sha256, guidance_version, guidance_sha256 "
        "FROM xacl_private.quality_protocol_config WHERE protocol_id=%s",
        (OLD_PROTOCOL_ID,),
    ).fetchone()
    assert existing == (OLD_RUBRIC, OLD_RUBRIC_SHA, OLD_GUIDANCE, OLD_GUIDANCE_SHA), existing
    assert conn.execute(
        "SELECT 1 FROM xacl_private.quality_protocol_config WHERE protocol_id=%s",
        (PROTOCOL_ID,),
    ).fetchone() is None
    initial_v1_snapshot = snapshot_v1(conn)

assert_prerequisite_failure(
    "ALTER FUNCTION xacl_private.validate_writing_annotation_record(jsonb,text,text,text,text,text,text) "
    "RENAME TO validate_writing_annotation_record_9p_qa",
    "xacl_private.validate_writing_annotation_record(jsonb,text,text,text,text,text,text)",
)
assert_prerequisite_failure(
    "ALTER FUNCTION xacl_private.quality_record_or_empty(text,text,text) RENAME TO quality_record_or_empty_9p_qa",
    "xacl_private.quality_record_or_empty(text,text,text)",
)

# A recognized helper set is not enough if its stored protocol hashes drift.
with psycopg.connect(DSN, autocommit=True) as conn:
    conn.execute("BEGIN")
    try:
        conn.execute(
            "UPDATE xacl_private.quality_protocol_config SET guidance_sha256=%s WHERE protocol_id=%s",
            ("0" * 64, OLD_PROTOCOL_ID),
        )
        try:
            migration(conn)
        except psycopg.Error as exc:
            assert exc.sqlstate == "P0001", (exc.sqlstate, exc.diag.message_primary)
            assert "previous writing-quality configuration" in (exc.diag.message_primary or "")
        else:
            raise AssertionError("migration 004 must reject configuration drift")
    finally:
        conn.execute("ROLLBACK")
    assert snapshot_v1(conn) == initial_v1_snapshot, "failed prerequisite/drift probes changed old data"

# Seed a completed old-scope record through its public RPC, then use it as a
# byte-for-byte current-record/history regression fixture across migration 004.
annotator_id = "QA_9P_" + uuid.uuid4().hex[:12]
recovery_code = "d" * 64
user_id = uuid.uuid4()
now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
with auth_connection(user_id) as conn:
    created = rpc(conn, "xacl_writing_register_annotator", (annotator_id, recovery_code))["record"]
    old_row = {
        "scores": {key: 4 for key in SCORE_KEYS},
        "auxiliary_checks": {"pdf_visual_integrity": {"status": "not_assessed", "score": None, "issue_codes": []}},
        "version_differences": [],
        "version_notes": "Prior-scope fixture.",
        "reference_exposed": False,
        "reviewed_full_scope": True,
        "status": "completed",
        "updated_at": now,
    }
    old_record = {
        **created,
        "revision": 0,
        "updated_at": now,
        "annotations": {"RL01": old_row},
    }
    old_saved = rpc(conn, "xacl_writing_save_annotations", (
        annotator_id, Jsonb(old_record), OLD_GUIDANCE, OLD_GUIDANCE_SHA, "save",
    ))
    assert "record" in old_saved, old_saved

with psycopg.connect(DSN, autocommit=True) as conn:
    before = snapshot_v1(conn)
    assert before[1] and before[2], "the regression fixture must contain v1 current and history rows"
    migration(conn)
    assert snapshot_v1(conn) == before, "migration 004 changed v1 config/current records/history"
    migration(conn)
    assert snapshot_v1(conn) == before, "reapplying migration 004 changed v1 config/current records/history"
    conn.execute(SECURITY_SQL, prepare=False)

with auth_connection(user_id) as conn:
    health = rpc(conn, "xacl_writing9p_annotation_health")
    assert health["ready"] is True and health["protocol_id"] == PROTOCOL_ID, health
    assert health["rubric_sha256"] == CONTRACT["rubric_sha256"]
    assert health["guidance_sha256"] == CONTRACT["guidance_sha256"]

    blank = rpc(conn, "xacl_writing9p_register_annotator", (annotator_id, recovery_code))["record"]
    assert blank["protocol_id"] == PROTOCOL_ID and blank["schema"] == SCHEMA
    assert blank["revision"] == 0 and blank["annotations"] == {}, blank
    assert rpc(conn, "xacl_writing9p_current_annotations")["record"] == blank
    assert rpc(conn, "xacl_writing9p_load_annotations", (annotator_id,))["record"] == blank
    assert rpc(conn, "xacl_writing_load_annotations", (annotator_id,))["record"] == old_saved["record"]

device_id = uuid.uuid4()
with auth_connection(device_id) as conn:
    restored = rpc(conn, "xacl_writing9p_resume_annotator", (annotator_id, recovery_code))["record"]
    assert restored == blank
    assert rpc(conn, "xacl_writing9p_current_annotations")["record"] == blank

with auth_connection(user_id) as conn:
    old_payload = rpc(conn, "xacl_writing9p_save_annotations", (
        annotator_id, Jsonb(old_saved["record"]), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert old_payload.get("error") == "study_mismatch", old_payload

    first = {
        "schema": SCHEMA,
        "protocol_id": PROTOCOL_ID,
        "dataset_id": DATASET_ID,
        "manifest_sha256": MANIFEST,
        "rubric_version": RUBRIC,
        "annotator_id": annotator_id,
        "revision": 0,
        "created_at": blank["created_at"],
        "updated_at": now,
        "annotations": {
            "RL01": {
                "scores": {key: 5 for key in SCORE_KEYS},
                "auxiliary_checks": {"pdf_visual_integrity": {"status": "not_assessed", "score": None, "issue_codes": []}},
                "version_differences": [],
                "version_notes": "",
                "reference_exposed": False,
                "reviewed_full_scope": True,
                "status": "completed",
                "updated_at": now,
            }
        },
    }
barrier = threading.Barrier(2)

def first_save_race(uid):
    with auth_connection(uid) as conn:
        barrier.wait(timeout=20)
        return rpc(conn, "xacl_writing9p_save_annotations", (
            annotator_id, Jsonb(first), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
        ))

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    race = list(pool.map(first_save_race, (user_id, device_id)))
wins = [result for result in race if "record" in result]
conflicts = [result for result in race if result.get("error") == "revision_conflict"]
assert len(wins) == 1 and wins[0]["record"]["revision"] == 1, race
assert len(conflicts) == 1 and conflicts[0]["current_revision"] == 1, race
saved = wins[0]
with auth_connection(user_id) as conn:
    assert rpc(conn, "xacl_writing9p_load_annotations", (annotator_id,))["record"] == saved["record"]
with auth_connection(device_id) as conn:
    assert rpc(conn, "xacl_writing9p_current_annotations")["record"] == saved["record"]

    stale = rpc(conn, "xacl_writing9p_save_annotations", (
        annotator_id, Jsonb(first), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert stale.get("error") == "revision_conflict", stale

    exposed = copy.deepcopy(saved["record"])
    exposed["revision"] = 1
    exposed["annotations"]["RL01"]["reference_exposed"] = True
    exposed["annotations"]["RL01"]["updated_at"] = now
    opened = rpc(conn, "xacl_writing9p_save_annotations", (
        annotator_id, Jsonb(exposed), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert opened["record"]["revision"] == 2, opened
    reset = copy.deepcopy(opened["record"])
    reset["revision"] = 2
    reset["annotations"]["RL01"]["reference_exposed"] = False
    result = rpc(conn, "xacl_writing9p_save_annotations", (
        annotator_id, Jsonb(reset), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert result.get("error") == "invalid_record", result

    try:
        rpc(conn, "xacl_writing_save_annotations", (
            annotator_id, Jsonb(old_saved["record"]), OLD_GUIDANCE, OLD_GUIDANCE_SHA, "save",
        ))
    except psycopg.errors.InsufficientPrivilege:
        pass
    else:
        raise AssertionError("the previous full-scope writing RPC must be read-only after migration 004")

outsider = uuid.uuid4()
with auth_connection(outsider) as conn:
    denied = rpc(conn, "xacl_writing9p_load_annotations", (annotator_id,))
    assert denied.get("error") == "invalid_access", denied

with psycopg.connect(DSN, autocommit=True) as conn:
    final_v1 = snapshot_v1(conn)
    assert final_v1[:3] == before[:3], "nine-page annotations changed the archived v1 config/records/history"
    row = conn.execute(
        "SELECT revision, current_record FROM xacl_private.quality_annotation_records "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s",
        (PROTOCOL_ID, DATASET_ID, annotator_id),
    ).fetchone()
    history = conn.execute(
        "SELECT revision FROM xacl_private.quality_annotation_history "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s ORDER BY revision",
        (PROTOCOL_ID, DATASET_ID, annotator_id),
    ).fetchall()
    assert row[0] == 2 and row[1]["annotations"]["RL01"]["reference_exposed"] is True, row
    assert [item[0] for item in history] == [1, 2], history

print("PASS: migration 004 is isolated/idempotent; archived rows, protocol hashes, participant identities and device sessions survive migration; missing helpers/config drift fail closed; 9p recovery, simultaneous first-save conflict, isolation, history and exposure controls pass.")
