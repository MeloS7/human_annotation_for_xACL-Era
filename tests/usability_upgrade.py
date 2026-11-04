#!/usr/bin/env python3
"""Install/test migration 005 after the fresh disposable 001-004 migration stack."""
from __future__ import annotations

import concurrent.futures
import copy
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
PROTOCOL_DIR = ROOT / "site/protocols/latex-data-usability-v1"
CONTRACT = json.loads((PROTOCOL_DIR / "protocol.json").read_text())
RUBRIC_BYTES = (PROTOCOL_DIR / "rubric.json").read_bytes()
GUIDANCE_BYTES = (PROTOCOL_DIR / "guidance.json").read_bytes()
MIGRATION = (ROOT / "supabase/005_data_usability.sql").read_text()
SECURITY_SQL = (ROOT / "tests/usability_backend.sql").read_text()
ARCHIVED_9P = json.loads(
    (ROOT / "site/protocols/latex-writing-quality-9p-v1/config.json").read_text()
)

PROTOCOL_ID = "latex-data-usability-v1"
SCHEMA = "xacl.latex-data-usability-annotations.v1"
RUBRIC = "latex-data-usability-rubric-v1"
GUIDANCE = "latex-data-usability-guidance-20261104-v1"
DATASET_ID = "revisionlens-alignment30-v1"
MANIFEST = "d60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071"
OLD_9P_PROTOCOL = "latex-writing-quality-9p-v1"
OLD_WRITING_PROTOCOL = "latex-writing-quality-v1"
OLD_9P_GUIDANCE_SHA = ARCHIVED_9P["guidance_sha256"]
OLD_9P_RUBRIC_SHA = ARCHIVED_9P["rubric_sha256"]
SCORE_KEYS = [
    "text_integrity_readability",
    "document_structural_integrity",
    "nontext_asset_integrity",
    "overall_data_usability",
]
VISUAL_ISSUES = [
    "missing_glyphs", "overlap", "clipping", "unexpected_blank_regions", "unreadable_objects",
]
NOW = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def rpc(conn, name, args=()):
    placeholders = ",".join("%s" for _ in args)
    return conn.execute(f"SELECT public.{name}({placeholders})", args).fetchone()[0]


def auth_connection(user_id=None):
    conn = psycopg.connect(DSN, autocommit=True)
    conn.execute("SET ROLE authenticated")
    claims = {
        "sub": str(user_id or uuid.uuid4()),
        "role": "authenticated",
        "aud": "authenticated",
        "is_anonymous": True,
    }
    conn.execute("SELECT pg_catalog.set_config('request.jwt.claims', %s, false)", (json.dumps(claims),))
    return conn


def snapshot_prior_state(conn):
    """Capture all old protocol configs/ratings plus shared identities and sessions."""
    configs = conn.execute(
        "SELECT protocol_id, study_id, dataset_id, manifest_sha256, record_schema, rubric_version, "
        "rubric_sha256, guidance_version, guidance_sha256, created_at "
        "FROM xacl_private.quality_protocol_config WHERE protocol_id<>%s ORDER BY protocol_id",
        (PROTOCOL_ID,),
    ).fetchall()
    records = conn.execute(
        "SELECT protocol_id, study_id, annotator_id, revision, current_record, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256, saved_at FROM xacl_private.quality_annotation_records "
        "WHERE protocol_id<>%s ORDER BY protocol_id, study_id, annotator_id",
        (PROTOCOL_ID,),
    ).fetchall()
    history = conn.execute(
        "SELECT protocol_id, study_id, annotator_id, revision, full_record, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256, operation, saved_at FROM xacl_private.quality_annotation_history "
        "WHERE protocol_id<>%s ORDER BY protocol_id, study_id, annotator_id, revision",
        (PROTOCOL_ID,),
    ).fetchall()
    participants = conn.execute(
        "SELECT study_id, annotator_id, recovery_code_sha256, revoked_at, created_at "
        "FROM xacl_private.participants WHERE study_id=%s ORDER BY annotator_id", (DATASET_ID,)
    ).fetchall()
    sessions = conn.execute(
        "SELECT study_id, user_id, annotator_id, created_at FROM xacl_private.participant_sessions "
        "WHERE study_id=%s ORDER BY user_id", (DATASET_ID,)
    ).fetchall()
    return configs, records, history, participants, sessions


def assert_prior_state_preserved(before, after):
    # New-protocol registration and recovery legitimately add identity/session
    # rows. Every row that existed before migration must remain byte-for-byte the
    # same; all archived protocol config, current rows, and history remain exact.
    assert before[:3] == after[:3], "an archived protocol config/record/history row changed"
    assert set(before[3]).issubset(after[3]), "an existing participant/recovery identity changed or disappeared"
    assert set(before[4]).issubset(after[4]), "an existing device/session binding changed or disappeared"


def run_migration(conn):
    conn.execute(MIGRATION, prepare=False)


def assert_failed_migration(ddl, expected_message, sqlstate="55000"):
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("BEGIN")
        try:
            conn.execute(ddl)
            try:
                run_migration(conn)
            except psycopg.Error as exc:
                message = exc.diag.message_primary or ""
                hint = exc.diag.message_hint or ""
                assert exc.sqlstate == sqlstate, (exc.sqlstate, message)
                assert expected_message in message, message
                if sqlstate == "55000":
                    assert "migrations 001, 002, 003 and 004" in hint, hint
            else:
                raise AssertionError(f"migration 005 must fail closed for {expected_message}")
        finally:
            conn.execute("ROLLBACK")


def annotation(scores=None, *, status="completed", reviewed=True, visual=None):
    scores = scores or {key: 4 for key in SCORE_KEYS}
    return {
        "scores": scores,
        "auxiliary_checks": {
            "pdf_visual_integrity": visual or {
                "status": "not_assessed", "score": None, "issue_codes": [],
            }
        },
        "version_differences": [],
        "version_notes": "",
        "reference_exposed": False,
        "reviewed_full_scope": reviewed,
        "status": status,
        "updated_at": NOW,
    }


def payload(blank_record, annotator_id, annotations):
    return {
        **blank_record,
        "revision": 0,
        "updated_at": NOW,
        "annotations": annotations,
    }


def test_assets_match_contract():
    assert CONTRACT["protocol_id"] == PROTOCOL_ID
    assert CONTRACT["record_schema"] == SCHEMA
    assert CONTRACT["rubric_version"] == RUBRIC
    assert CONTRACT["guidance_version"] == GUIDANCE
    assert CONTRACT["rpc_prefix"] == "xacl_usability_"
    assert CONTRACT["score_keys"] == SCORE_KEYS
    assert CONTRACT["na_keys"] == ["nontext_asset_integrity"]
    assert hashlib.sha256(RUBRIC_BYTES).hexdigest() == CONTRACT["rubric_sha256"]
    assert hashlib.sha256(GUIDANCE_BYTES).hexdigest() == CONTRACT["guidance_sha256"]
    assert CONTRACT["scope_policy"]["first_page"] == 1
    assert CONTRACT["scope_policy"]["last_page_inclusive"] == 9
    assert "__USABILITY_" not in MIGRATION
    assert OLD_9P_PROTOCOL == ARCHIVED_9P["protocol_id"]


test_assets_match_contract()

with psycopg.connect(DSN, autocommit=True) as conn:
    assert conn.execute(
        "SELECT 1 FROM xacl_private.quality_protocol_config WHERE protocol_id=%s", (PROTOCOL_ID,)
    ).fetchone() is None
    old_9p = conn.execute(
        "SELECT study_id, dataset_id, manifest_sha256, record_schema, rubric_version, rubric_sha256, "
        "guidance_version, guidance_sha256 FROM xacl_private.quality_protocol_config WHERE protocol_id=%s",
        (OLD_9P_PROTOCOL,),
    ).fetchone()
    assert old_9p == (
        DATASET_ID, DATASET_ID, MANIFEST, ARCHIVED_9P["record_schema"],
        ARCHIVED_9P["rubric_version"], OLD_9P_RUBRIC_SHA,
        ARCHIVED_9P["guidance_version"], OLD_9P_GUIDANCE_SHA,
    ), old_9p

# Seed a completed 9p row so migration and repeat application must preserve an
# actual old record and revision history, not only protocol config metadata.
annotator_id = "QA_USABILITY_" + uuid.uuid4().hex[:12]
recovery_code = uuid.uuid4().hex + uuid.uuid4().hex
primary_user = uuid.uuid4()
device_user = uuid.uuid4()
with auth_connection(primary_user) as conn:
    prior_blank = rpc(conn, "xacl_writing9p_register_annotator", (annotator_id, recovery_code))["record"]
    prior_scores = {
        "language_clarity": 4,
        "coherence_flow": 4,
        "structural_completeness": 4,
        "technical_expression": 4,
        "overall_writing_quality": 4,
    }
    prior_row = {
        "scores": prior_scores,
        "auxiliary_checks": {"pdf_visual_integrity": {"status": "not_assessed", "score": None, "issue_codes": []}},
        "version_differences": [],
        "version_notes": "Archived nine-page fixture.",
        "reference_exposed": False,
        "reviewed_full_scope": True,
        "status": "completed",
        "updated_at": NOW,
    }
    old_record = {**prior_blank, "revision": 0, "updated_at": NOW, "annotations": {"RL01": prior_row}}
    prior_saved = rpc(conn, "xacl_writing9p_save_annotations", (
        annotator_id, Jsonb(old_record), ARCHIVED_9P["guidance_version"], OLD_9P_GUIDANCE_SHA, "save",
    ))
    assert "record" in prior_saved, prior_saved

with psycopg.connect(DSN, autocommit=True) as conn:
    prior_snapshot = snapshot_prior_state(conn)
    assert any(row[0] == OLD_9P_PROTOCOL for row in prior_snapshot[1])
    assert any(row[0] == OLD_9P_PROTOCOL for row in prior_snapshot[2])

assert_failed_migration(
    "ALTER FUNCTION xacl_private.quality_record_or_empty(text,text,text) "
    "RENAME TO quality_record_or_empty_usability_qa",
    "xacl_private.quality_record_or_empty(text,text,text)",
)
assert_failed_migration(
    "ALTER FUNCTION public.xacl_writing9p_annotation_health() RENAME TO xacl_writing9p_annotation_health_qa",
    "public.xacl_writing9p_annotation_health() from migration 004",
)

# A healthy 001-004 helper set still fails closed if the archived 004 config drifts.
assert_failed_migration(
    "UPDATE xacl_private.quality_protocol_config SET guidance_sha256='" + ("0" * 64) + "' "
    "WHERE protocol_id='latex-writing-quality-9p-v1'",
    "previous nine-page writing configuration differs",
    sqlstate="P0001",
)
with psycopg.connect(DSN, autocommit=True) as conn:
    assert snapshot_prior_state(conn) == prior_snapshot, "failed migration probes modified prior state"

# A conflicting new protocol row must not be silently accepted or overwrite
# owner-supplied data. The failed attempt is rolled back by the surrounding transaction.
with psycopg.connect(DSN, autocommit=True) as conn:
    conn.execute("BEGIN")
    try:
        conn.execute(
            "INSERT INTO xacl_private.quality_protocol_config "
            "(protocol_id,study_id,dataset_id,manifest_sha256,record_schema,rubric_version,rubric_sha256,guidance_version,guidance_sha256) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (PROTOCOL_ID, DATASET_ID, DATASET_ID, MANIFEST, SCHEMA, RUBRIC, "0" * 64, GUIDANCE, CONTRACT["guidance_sha256"]),
        )
        try:
            run_migration(conn)
        except psycopg.Error as exc:
            assert exc.sqlstate == "P0001", (exc.sqlstate, exc.diag.message_primary)
            assert "configuration differs from its frozen site protocol" in (exc.diag.message_primary or "")
        else:
            raise AssertionError("migration 005 must reject a conflicting preexisting new-protocol row")
    finally:
        conn.execute("ROLLBACK")
    assert snapshot_prior_state(conn) == prior_snapshot

with psycopg.connect(DSN, autocommit=True) as conn:
    run_migration(conn)
    assert snapshot_prior_state(conn) == prior_snapshot, "migration 005 modified preexisting protocol/config/identity data"
    run_migration(conn)
    assert snapshot_prior_state(conn) == prior_snapshot, "reapplying migration 005 modified archived data"
    conn.execute(SECURITY_SQL, prepare=False)

with auth_connection(primary_user) as conn:
    health = rpc(conn, "xacl_usability_annotation_health")
    assert health["ready"] is True and health["protocol_id"] == PROTOCOL_ID, health
    assert health["rubric_sha256"] == CONTRACT["rubric_sha256"]
    assert health["guidance_sha256"] == CONTRACT["guidance_sha256"]

    blank = rpc(conn, "xacl_usability_register_annotator", (annotator_id, recovery_code))["record"]
    assert blank["protocol_id"] == PROTOCOL_ID and blank["schema"] == SCHEMA
    assert blank["revision"] == 0 and blank["annotations"] == {}, blank
    assert rpc(conn, "xacl_usability_current_annotations")["record"] == blank
    assert rpc(conn, "xacl_usability_load_annotations", (annotator_id,))["record"] == blank
    assert rpc(conn, "xacl_writing9p_load_annotations", (annotator_id,))["record"] == prior_saved["record"]

with auth_connection(device_user) as conn:
    resumed = rpc(conn, "xacl_usability_resume_annotator", (annotator_id, recovery_code))["record"]
    assert resumed == blank
    assert rpc(conn, "xacl_usability_current_annotations")["record"] == blank

# Exact record contract: core scores can be 1-5/uncertain, and only the
# non-text-assets dimension also accepts na. Auxiliary visuals do not cap Overall.
with auth_connection(primary_user) as conn:
    valid_scores = {
        "text_integrity_readability": 3,
        "document_structural_integrity": 4,
        "nontext_asset_integrity": "na",
        "overall_data_usability": 5,
    }
    first_payload = payload(blank, annotator_id, {
        "RL01": annotation(
            valid_scores,
            visual={"status": "assessed", "score": 1, "issue_codes": ["missing_glyphs"]},
        ),
        "RL02": annotation({key: "uncertain" for key in SCORE_KEYS}),
    })

    # All core dimensions are mandatory for completion; auxiliary visual is optional.
    missing_score = copy.deepcopy(first_payload)
    missing_score["annotations"]["RL01"]["scores"]["text_integrity_readability"] = None
    result = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(missing_score), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert result.get("error") == "invalid_record" and "all four usability scores" in result.get("message", ""), result

    missing_review = copy.deepcopy(first_payload)
    missing_review["annotations"]["RL01"]["reviewed_full_scope"] = False
    result = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(missing_review), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert result.get("error") == "invalid_record" and "reviewed_full_scope=true" in result.get("message", ""), result

    for key in SCORE_KEYS:
        if key == "nontext_asset_integrity":
            continue
        invalid_na = copy.deepcopy(first_payload)
        invalid_na["annotations"]["RL01"]["scores"][key] = "na"
        result = rpc(conn, "xacl_usability_save_annotations", (
            annotator_id, Jsonb(invalid_na), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
        ))
        assert result.get("error") == "invalid_record", (key, result)

    for invalid_value in (0, 6, 2.5, "N/A", "NA"):
        invalid_score = copy.deepcopy(first_payload)
        invalid_score["annotations"]["RL01"]["scores"]["nontext_asset_integrity"] = invalid_value
        result = rpc(conn, "xacl_usability_save_annotations", (
            annotator_id, Jsonb(invalid_score), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
        ))
        assert result.get("error") == "invalid_record", (invalid_value, result)

    invalid_visual = copy.deepcopy(first_payload)
    invalid_visual["annotations"]["RL01"]["auxiliary_checks"]["pdf_visual_integrity"] = {
        "status": "not_assessed", "score": 1, "issue_codes": [],
    }
    result = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(invalid_visual), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert result.get("error") == "invalid_record", result

    result = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(first_payload), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert "record" in result and result["record"]["revision"] == 1, result
    first_saved = result["record"]
    assert first_saved["annotations"]["RL01"]["scores"]["overall_data_usability"] == 5
    assert first_saved["annotations"]["RL01"]["auxiliary_checks"]["pdf_visual_integrity"]["score"] == 1
    assert first_saved["annotations"]["RL01"]["scores"]["nontext_asset_integrity"] == "na"
    assert rpc(conn, "xacl_usability_load_annotations", (annotator_id,))["record"] == first_saved

# The same profile resumes on another anonymous identity. Only records within
# this protocol are returned, and readers without a profile binding are denied.
with auth_connection(device_user) as conn:
    assert rpc(conn, "xacl_usability_current_annotations")["record"] == first_saved
outsider = uuid.uuid4()
with auth_connection(outsider) as conn:
    assert rpc(conn, "xacl_usability_load_annotations", (annotator_id,)).get("error") == "invalid_access"

# Stale writes conflict; exposure is monotonic and survives edits. A low visual
# score never caps the separately stored core Overall score.
with auth_connection(primary_user) as conn:
    stale = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(first_payload), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert stale.get("error") == "revision_conflict" and stale.get("current_revision") == 1, stale

    exposed = copy.deepcopy(first_saved)
    exposed["revision"] = 1
    exposed["updated_at"] = NOW
    exposed["annotations"]["RL01"]["reference_exposed"] = True
    exposed["annotations"]["RL01"]["updated_at"] = NOW
    opened = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(exposed), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert opened["record"]["revision"] == 2 and opened["record"]["annotations"]["RL01"]["reference_exposed"] is True, opened

    reset = copy.deepcopy(opened["record"])
    reset["revision"] = 2
    reset["annotations"]["RL01"]["reference_exposed"] = False
    result = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(reset), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert result.get("error") == "invalid_record", result

    removed = copy.deepcopy(opened["record"])
    removed["revision"] = 2
    del removed["annotations"]["RL01"]
    result = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(removed), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert result.get("error") == "invalid_record", result

    # A later core edit retains the exposed-reference bit and accepts import history.
    edited = copy.deepcopy(opened["record"])
    edited["revision"] = 2
    edited["annotations"]["RL01"]["scores"]["overall_data_usability"] = 4
    edited["annotations"]["RL01"]["updated_at"] = NOW
    saved_edit = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(edited), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "import",
    ))
    assert saved_edit["record"]["revision"] == 3
    assert saved_edit["record"]["annotations"]["RL01"]["reference_exposed"] is True

    wrong_guidance = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(edited), CONTRACT["guidance_version"], "0" * 64, "save",
    ))
    assert wrong_guidance.get("error") == "study_mismatch", wrong_guidance
    wrong_operation = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(edited), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "unknown",
    ))
    assert wrong_operation.get("error") == "invalid_operation", wrong_operation

# First-save races from two valid device sessions serialize to one revision and
# one explicit conflict, retaining the established save semantics.
race_annotator = "QA_USABILITY_RACE_" + uuid.uuid4().hex[:10]
race_recovery = uuid.uuid4().hex + uuid.uuid4().hex
race_user1, race_user2 = uuid.uuid4(), uuid.uuid4()
with auth_connection(race_user1) as conn:
    race_blank = rpc(conn, "xacl_usability_register_annotator", (race_annotator, race_recovery))["record"]
with auth_connection(race_user2) as conn:
    assert rpc(conn, "xacl_usability_resume_annotator", (race_annotator, race_recovery))["record"] == race_blank
race_payload = payload(race_blank, race_annotator, {
    "RL03": annotation({
        "text_integrity_readability": "uncertain",
        "document_structural_integrity": 3,
        "nontext_asset_integrity": 2,
        "overall_data_usability": 3,
    })
})
barrier = threading.Barrier(2)


def save_race(user_id):
    with auth_connection(user_id) as conn:
        barrier.wait(timeout=20)
        return rpc(conn, "xacl_usability_save_annotations", (
            race_annotator, Jsonb(race_payload), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
        ))


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(save_race, (race_user1, race_user2)))
wins = [r for r in results if "record" in r]
conflicts = [r for r in results if r.get("error") == "revision_conflict"]
assert len(wins) == 1 and wins[0]["record"]["revision"] == 1, results
assert len(conflicts) == 1 and conflicts[0]["current_revision"] == 1, results

# A legacy 9p payload cannot be written under the new protocol identity, while
# archived reads remain available. All prior save RPCs are revoked by migration 005.
with auth_connection(primary_user) as conn:
    old_payload = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id, Jsonb(prior_saved["record"]), CONTRACT["guidance_version"], CONTRACT["guidance_sha256"], "save",
    ))
    assert old_payload.get("error") == "study_mismatch", old_payload
    assert rpc(conn, "xacl_writing9p_load_annotations", (annotator_id,))["record"] == prior_saved["record"]
    for legacy_rpc in (
        "xacl_save_annotations", "xacl_quality_save_annotations",
        "xacl_writing_save_annotations", "xacl_writing9p_save_annotations",
    ):
        try:
            rpc(conn, legacy_rpc, (annotator_id, Jsonb(prior_saved["record"]), OLD_9P_PROTOCOL,
                                   OLD_9P_GUIDANCE_SHA, "save"))
        except psycopg.errors.InsufficientPrivilege:
            continue
        except psycopg.Error as exc:
            # The base alignment endpoint has its older argument contract but is still revoked.
            if exc.sqlstate == "42501":
                continue
            raise
        raise AssertionError(f"archived write RPC {legacy_rpc} unexpectedly remained executable")

with psycopg.connect(DSN, autocommit=True) as conn:
    final_prior = snapshot_prior_state(conn)
    assert_prior_state_preserved(prior_snapshot, final_prior)
    new_row = conn.execute(
        "SELECT revision,current_record FROM xacl_private.quality_annotation_records "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s", (PROTOCOL_ID, DATASET_ID, annotator_id)
    ).fetchone()
    assert new_row[0] == 3 and new_row[1]["annotations"]["RL01"]["reference_exposed"] is True, new_row
    history = conn.execute(
        "SELECT revision,operation FROM xacl_private.quality_annotation_history "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s ORDER BY revision", (PROTOCOL_ID, DATASET_ID, annotator_id)
    ).fetchall()
    assert history == [(1, "save"), (2, "save"), (3, "import")], history

print("PASS: migration 005 is isolated/idempotent; 001-004 archives and identity bindings are unchanged; prerequisites, drift, exact config, strict score/visual rules, recovery, concurrency, exposure, history, and revoked legacy writes pass.")
