#!/usr/bin/env python3
"""Integration checks for migration 006 on a disposable PostgreSQL database."""
from __future__ import annotations

import copy
import datetime as dt
import json
import os
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
ASSET_DIR = ROOT / "site/followup49"
CONFIG = json.loads((ASSET_DIR / "config.json").read_text())
MANIFEST = json.loads((ASSET_DIR / "manifest.json").read_text())
MIGRATION = (ROOT / "supabase/006_followup49.sql").read_text()
SECURITY_SQL = (ROOT / "tests/followup49_backend.sql").read_text()
OLD_PROTOCOL = "latex-data-usability-v1"
PROTOCOL_ID = CONFIG["protocol_id"]
STUDY_ID = CONFIG["study_id"]
DATASET_ID = CONFIG["dataset_id"]
GUIDANCE_VERSION = CONFIG["guidance_version"]
GUIDANCE_SHA256 = CONFIG["guidance_sha256"]
NOW = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
PAPER_ISSUES = {paper["sample_id"]: [issue["id"] for issue in paper["issues"]] for paper in MANIFEST["papers"]}


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


def migration(conn):
    conn.execute(MIGRATION, prepare=False)


def snapshots(conn):
    """Capture every pre-existing row except this protocol's own namespace."""
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
        "FROM xacl_private.participants WHERE study_id=%s ORDER BY annotator_id",
        (STUDY_ID,),
    ).fetchall()
    sessions = conn.execute(
        "SELECT study_id, user_id, annotator_id, created_at FROM xacl_private.participant_sessions "
        "WHERE study_id=%s ORDER BY user_id",
        (STUDY_ID,),
    ).fetchall()
    return configs, records, history, participants, sessions


def make_old_sentinel(conn, annotator_id, recovery_code):
    blank = rpc(conn, "xacl_usability_register_annotator", (annotator_id, recovery_code))["record"]
    score_keys = (
        "text_integrity_readability", "document_structural_integrity",
        "nontext_asset_integrity", "overall_data_usability",
    )
    annotation = {
        "scores": {key: 4 for key in score_keys},
        "auxiliary_checks": {
            "pdf_visual_integrity": {"status": "not_assessed", "score": None, "issue_codes": []}
        },
        "version_differences": [],
        "version_notes": "Sentinel retained by follow-up backend test.",
        "reference_exposed": False,
        "reviewed_full_scope": True,
        "status": "completed",
        "updated_at": NOW,
    }
    payload = {**blank, "revision": 0, "updated_at": NOW, "annotations": {"RL01": annotation}}
    result = rpc(conn, "xacl_usability_save_annotations", (
        annotator_id,
        Jsonb(payload),
        "latex-data-usability-guidance-20261104-v1",
        "37ea7993b18649afdc5491be3a54cc9914c9bc0d1901cbff58ce5803deee7468",
        "save",
    ))
    assert "record" in result, result
    return result["record"]


def followup_payload(blank, annotator_id, annotations):
    return {**blank, "annotator_id": annotator_id, "revision": blank["revision"], "updated_at": NOW, "annotations": annotations}


def row(status, findings):
    return {"status": status, "updated_at": NOW, "findings": findings}


def finding(verdict="confirmed", category=None, note="QA evidence."):
    return {"verdict": verdict, "category": category, "note": note}


def save(conn, annotator_id, payload):
    return rpc(conn, "xacl_followup49_save_annotations", (
        annotator_id, Jsonb(payload), GUIDANCE_VERSION, GUIDANCE_SHA256, "save",
    ))


# Preserve a real saved row and history in the 30-paper cohort before applying
# the migration. This remains valid whether the 006 migration has run before.
annotator_id = "QA_FOLLOWUP49_" + uuid.uuid4().hex[:12]
recovery_code = uuid.uuid4().hex + uuid.uuid4().hex
primary_user, device_user, outsider = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
with auth_connection(primary_user) as conn:
    old_sentinel = make_old_sentinel(conn, annotator_id, recovery_code)
with psycopg.connect(DSN, autocommit=True) as conn:
    before = snapshots(conn)
    assert any(r[0] == OLD_PROTOCOL and r[2] == annotator_id for r in before[1]), "30-paper sentinel missing"
    migration(conn)
    after_first = snapshots(conn)
    assert before == after_first, "migration 006 changed an existing protocol, record/history, or participant/session"
    migration(conn)
    after_repeat = snapshots(conn)
    assert before == after_repeat, "reapplying migration 006 changed pre-existing rows"
    conn.execute(SECURITY_SQL, prepare=False)
    conn.execute("BEGIN")
    try:
        conn.execute(
            "UPDATE xacl_private.followup49_issue_allowlist SET issue_id='overall_data_usability' "
            "WHERE protocol_id=%s AND sample_id='J015' AND issue_id='pdf_visual_integrity'",
            (PROTOCOL_ID,),
        )
        assert rpc(conn, "xacl_followup49_annotation_health").get("ready") is False, "health must detect a changed per-paper allowlist"
    finally:
        conn.rollback()

with auth_connection(primary_user) as conn:
    health = rpc(conn, "xacl_followup49_annotation_health")
    for key in (
        "study_id", "dataset_id", "manifest_sha256", "rubric_version", "rubric_sha256",
        "guidance_version", "guidance_sha256", "protocol_id", "record_schema",
    ):
        expected = CONFIG[key]
        assert health.get(key) == expected, (key, health.get(key), expected)
    assert health.get("ready") is True and health.get("auth_mode") == "anonymous_recovery_v1", health

    blank = rpc(conn, "xacl_followup49_register_annotator", (annotator_id, recovery_code))["record"]
    assert blank["schema"] == CONFIG["record_schema"]
    assert blank["protocol_id"] == PROTOCOL_ID and blank["dataset_id"] == DATASET_ID
    assert blank["revision"] == 0 and blank["annotations"] == {}, blank
    assert rpc(conn, "xacl_followup49_current_annotations")["record"] == blank
    assert rpc(conn, "xacl_followup49_load_annotations", (annotator_id,))["record"] == blank
    assert rpc(conn, "xacl_usability_load_annotations", (annotator_id,))["record"] == old_sentinel

# The shared recovery identity can be resumed from another anonymous Supabase
# identity; follow-up results remain protocol-isolated.
with auth_connection(device_user) as conn:
    assert rpc(conn, "xacl_followup49_resume_annotator", (annotator_id, recovery_code))["record"] == blank
    assert rpc(conn, "xacl_followup49_current_annotations")["record"] == blank
    assert rpc(conn, "xacl_followup49_load_annotations", (annotator_id,))["record"] == blank
with auth_connection(outsider) as conn:
    assert rpc(conn, "xacl_followup49_load_annotations", (annotator_id,)).get("error") == "invalid_access"
    assert rpc(conn, "xacl_followup49_resume_annotator", (annotator_id, "0" * 64)).get("error") == "invalid_access"

pdf_key = "pdf_visual_integrity"
coverage_key = "page_9_coverage"
assert PAPER_ISSUES["J007"] == [pdf_key, coverage_key]
draft = followup_payload(blank, annotator_id, {
    "J007": row("draft", {pdf_key: finding(category="pdf_rendering")}),
})
with auth_connection(primary_user) as conn:
    # Drafts may contain only a subset of assigned issue findings.
    first = save(conn, annotator_id, draft)
    assert first.get("record", {}).get("revision") == 1, first
    first_saved = first["record"]

    incomplete = copy.deepcopy(first_saved)
    incomplete["revision"] = 1
    incomplete["annotations"]["J007"]["status"] = "completed"
    incomplete["annotations"]["J007"]["updated_at"] = NOW
    rejected = save(conn, annotator_id, incomplete)
    assert rejected.get("error") == "invalid_record" and "every assigned issue" in rejected.get("message", ""), rejected

    unknown_paper = followup_payload(blank, annotator_id, {"J999": row("draft", {})})
    rejected = save(conn, annotator_id, unknown_paper)
    assert rejected.get("error") == "invalid_record" and "unknown follow-up paper" in rejected.get("message", ""), rejected

    unknown_issue = copy.deepcopy(draft)
    unknown_issue["annotations"]["J007"]["findings"]["overall_data_usability"] = finding()
    rejected = save(conn, annotator_id, unknown_issue)
    assert rejected.get("error") == "invalid_record" and "unknown issue ID" in rejected.get("message", ""), rejected

    for invalid_finding in (
        finding(verdict="uncertain"),
        finding(category="citation_mismatch"),
        finding(note="x" * 2001),
    ):
        invalid = copy.deepcopy(draft)
        invalid["annotations"]["J007"]["findings"][pdf_key] = invalid_finding
        rejected = save(conn, annotator_id, invalid)
        assert rejected.get("error") == "invalid_record", (invalid_finding, rejected)

    extra_field = copy.deepcopy(draft)
    extra_field["annotations"]["J007"]["findings"][pdf_key]["score"] = 1
    rejected = save(conn, annotator_id, extra_field)
    assert rejected.get("error") == "invalid_record", rejected

    invalid_status = copy.deepcopy(draft)
    invalid_status["annotations"]["J007"]["status"] = "done"
    rejected = save(conn, annotator_id, invalid_status)
    assert rejected.get("error") == "invalid_record", rejected

    complete = copy.deepcopy(first_saved)
    complete["revision"] = 1
    complete["updated_at"] = NOW
    complete["annotations"]["J007"] = row("completed", {
        pdf_key: finding(category="pdf_rendering"),
        coverage_key: finding(verdict="not_found", category="outside_window", note="No page 9 issue found."),
    })
    completed = save(conn, annotator_id, complete)
    assert completed.get("record", {}).get("revision") == 2, completed
    completed_record = completed["record"]
    assert rpc(conn, "xacl_followup49_load_annotations", (annotator_id,))["record"] == completed_record

    # A stale device revision receives a conflict rather than overwriting.
    stale = copy.deepcopy(first_saved)
    stale["revision"] = 1
    rejected = save(conn, annotator_id, stale)
    assert rejected.get("error") == "revision_conflict" and rejected.get("current_revision") == 2, rejected

with auth_connection(device_user) as conn:
    assert rpc(conn, "xacl_followup49_current_annotations")["record"] == completed_record
    assert rpc(conn, "xacl_usability_current_annotations")["record"] == old_sentinel

with psycopg.connect(DSN, autocommit=True) as conn:
    followup_row = conn.execute(
        "SELECT revision,current_record FROM xacl_private.quality_annotation_records "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s",
        (PROTOCOL_ID, STUDY_ID, annotator_id),
    ).fetchone()
    assert followup_row == (2, completed_record), followup_row
    followup_history = conn.execute(
        "SELECT revision,operation,full_record FROM xacl_private.quality_annotation_history "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s ORDER BY revision",
        (PROTOCOL_ID, STUDY_ID, annotator_id),
    ).fetchall()
    assert [(r[0], r[1]) for r in followup_history] == [(1, "save"), (2, "save")], followup_history
    old_row = conn.execute(
        "SELECT revision,current_record FROM xacl_private.quality_annotation_records "
        "WHERE protocol_id=%s AND study_id=%s AND annotator_id=%s",
        (OLD_PROTOCOL, STUDY_ID, annotator_id),
    ).fetchone()
    assert old_row == (1, old_sentinel), old_row
    issue_count = conn.execute(
        "SELECT count(*),count(DISTINCT sample_id) FROM xacl_private.followup49_issue_allowlist "
        "WHERE protocol_id=%s", (PROTOCOL_ID,),
    ).fetchone()
    assert issue_count == (63, 49), issue_count

print("PASS: migration 006 is additive/idempotent; same-account recovery, strict allowlist validation, draft/completed saves, revision conflicts, immutable history, and 30-paper isolation pass.")
