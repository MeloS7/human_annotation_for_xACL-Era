#!/usr/bin/env python3
"""Exercise v2/v3-to-v4 database upgrades on a disposable database only."""
import os
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb


if os.environ.get("XACL_DISPOSABLE_DATABASE") != "1":
    raise SystemExit("Set XACL_DISPOSABLE_DATABASE=1 only for an isolated test database")
dsn = os.environ.get("QA_DATABASE_URL", "")
if not dsn:
    raise SystemExit("QA_DATABASE_URL is required")

root = Path(__file__).resolve().parents[1]
migration = (root / "supabase/001_annotation.sql").read_text()
study_id = "revisionlens-alignment30-v1"
manifest = "d60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071"
rubric = "alignment-rubric-v1"
v2 = (
    "alignment-guidance-20261022-v2",
    "7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3",
)
v3 = (
    "alignment-guidance-20261024-v3",
    "3ab9433b66c448f211567717ce21df356892956d5f55d5a9adb4a1830340d990",
)
v4 = (
    "alignment-guidance-20261024-v4",
    "a2bb9e881d2bb8c1947196bb025cf8145d788acb2a8a3635396a81300dc4a59c",
)
now = "2026-10-24T12:00:00.000Z"


def fixture_record(annotator_id, period, integrated=False):
    annotation = {
        "scores": {
            "text_alignment": 4,
            "figure_alignment": 4,
            "table_alignment": "na",
            "equation_alignment": "na",
            "structure_alignment": 4,
            "content_coverage": 4,
            "overall_alignment": 4,
            "visual_integrity": 4,
        },
        "objects": {
            "figure": {"compiled": "present", "official": "present"},
            "table": {"compiled": "absent", "official": "absent"},
            "equation": {"compiled": "absent", "official": "absent"},
        },
        "evidence": f"Legacy {period} fixture; retain the original v1 annotation shape.",
        "notes": "",
        "flags": [],
        "reviewed_full_scope": False,
        "status": "draft",
        "updated_at": now,
    }
    if integrated:
        annotation["scoring_protocol"] = "integrated-presence-v1"
        annotation["object_score_reasons"] = {"figure": None, "table": None, "equation": None}
    return {
        "schema": "revisionlens.alignment-annotations.v1",
        "dataset_id": study_id,
        "manifest_sha256": manifest,
        "rubric_version": rubric,
        "annotator_id": annotator_id,
        "revision": 1,
        "created_at": now,
        "updated_at": now,
        "annotations": {"RL01": annotation},
    }


def migrate(conn):
    # Simple-query mode accepts the migration's explicit BEGIN/COMMIT and its
    # complete function bodies without splitting SQL at embedded semicolons.
    conn.execute(migration, prepare=False)


def snapshot(conn, annotator_id):
    participant = conn.execute(
        "SELECT study_id, annotator_id, recovery_code_sha256, revoked_at, created_at "
        "FROM xacl_private.participants WHERE study_id=%s AND annotator_id=%s",
        (study_id, annotator_id),
    ).fetchone()
    sessions = conn.execute(
        "SELECT study_id, user_id, annotator_id, created_at "
        "FROM xacl_private.participant_sessions WHERE study_id=%s AND annotator_id=%s ORDER BY user_id",
        (study_id, annotator_id),
    ).fetchall()
    current = conn.execute(
        "SELECT revision, current_record, guidance_version, guidance_sha256, saved_at "
        "FROM xacl_private.annotation_records WHERE study_id=%s AND annotator_id=%s",
        (study_id, annotator_id),
    ).fetchone()
    history = conn.execute(
        "SELECT history_id, revision, full_record, guidance_version, guidance_sha256, operation, saved_at "
        "FROM xacl_private.annotation_history WHERE study_id=%s AND annotator_id=%s ORDER BY revision",
        (study_id, annotator_id),
    ).fetchall()
    return participant, sessions, current, history


def seed_legacy(conn, annotator_id, user_id, guidance, integrated=False):
    if conn.execute(
        "SELECT 1 FROM xacl_private.participants WHERE study_id=%s AND annotator_id=%s",
        (study_id, annotator_id),
    ).fetchone():
        raise SystemExit(f"Disposable upgrade database already contains fixture {annotator_id}; use a fresh database")
    record = fixture_record(annotator_id, guidance[0], integrated=integrated)
    conn.execute(
        "INSERT INTO xacl_private.participants (study_id, annotator_id, recovery_code_sha256) "
        "VALUES (%s, %s, extensions.digest(pg_catalog.convert_to('disposable-fixture', 'UTF8'), 'sha256'))",
        (study_id, annotator_id),
    )
    conn.execute(
        "INSERT INTO xacl_private.participant_sessions (study_id, user_id, annotator_id) VALUES (%s, %s, %s)",
        (study_id, user_id, annotator_id),
    )
    conn.execute(
        "INSERT INTO xacl_private.annotation_records "
        "(study_id, annotator_id, revision, current_record, guidance_version, guidance_sha256, saved_at) "
        "VALUES (%s, %s, 1, %s, %s, %s, pg_catalog.clock_timestamp())",
        (study_id, annotator_id, Jsonb(record), guidance[0], guidance[1]),
    )
    conn.execute(
        "INSERT INTO xacl_private.annotation_history "
        "(study_id, annotator_id, revision, full_record, guidance_version, guidance_sha256, operation, saved_at) "
        "VALUES (%s, %s, 1, %s, %s, %s, 'save', pg_catalog.clock_timestamp())",
        (study_id, annotator_id, Jsonb(record), guidance[0], guidance[1]),
    )


def config(conn):
    return conn.execute(
        "SELECT dataset_id, manifest_sha256, rubric_version, guidance_version, guidance_sha256 "
        "FROM xacl_private.study_config WHERE study_id=%s",
        (study_id,),
    ).fetchone()


def expected_config(guidance):
    return (study_id, manifest, rubric, guidance[0], guidance[1])


with psycopg.connect(dsn, autocommit=True) as conn:
    conn.execute("SET client_encoding TO UTF8")
    if config(conn) != expected_config(v4):
        raise SystemExit(f"Test database must start at the current v4 config, got {config(conn)!r}")

    # Upgrade a legacy v2 installation, retaining the original participant
    # binding, current row, full history row, timestamps and row-level guidance.
    v2_name = "QA_UPGRADE_V2"
    seed_legacy(conn, v2_name, "20000000-0000-4000-8000-000000000002", v2)
    conn.execute(
        "UPDATE xacl_private.study_config SET guidance_version=%s, guidance_sha256=%s WHERE study_id=%s",
        (*v2, study_id),
    )
    v2_before = snapshot(conn, v2_name)
    if v2_before[0] is None or len(v2_before[1]) != 1 or v2_before[2] is None or len(v2_before[3]) != 1:
        raise SystemExit("Could not establish the deterministic v2 participant/current/history fixture")

    migrate(conn)
    if config(conn) != expected_config(v4):
        raise SystemExit(f"Known v2 config was not upgraded exactly: {config(conn)!r}")
    v2_after = snapshot(conn, v2_name)
    if v2_after != v2_before:
        raise SystemExit("v2 upgrade rewrote participant binding, annotation record, history, or metadata")
    if "scoring_protocol" in v2_after[2][1]["annotations"]["RL01"]:
        raise SystemExit("legacy v2 rating was incorrectly promoted to the integrated protocol")

    # A reapply must preserve both the new config and every old row.
    migrate(conn)
    if config(conn) != expected_config(v4) or snapshot(conn, v2_name) != v2_after:
        raise SystemExit("reapplying the v2 migration changed the config or legacy rows")

    # Independently upgrade a v3 installation after the v2 case, proving that
    # the second accepted source version also preserves its own history.
    v3_name = "QA_UPGRADE_V3"
    seed_legacy(conn, v3_name, "30000000-0000-4000-8000-000000000003", v3, integrated=True)
    conn.execute(
        "UPDATE xacl_private.study_config SET guidance_version=%s, guidance_sha256=%s WHERE study_id=%s",
        (*v3, study_id),
    )
    v3_before = snapshot(conn, v3_name)
    if v3_before[0] is None or len(v3_before[1]) != 1 or v3_before[2] is None or len(v3_before[3]) != 1:
        raise SystemExit("Could not establish the deterministic v3 participant/current/history fixture")

    migrate(conn)
    if config(conn) != expected_config(v4):
        raise SystemExit(f"Known v3 config was not upgraded exactly: {config(conn)!r}")
    v3_after = snapshot(conn, v3_name)
    if v3_after != v3_before or snapshot(conn, v2_name) != v2_after:
        raise SystemExit("v3 upgrade rewrote v2/v3 participant binding, annotation record, history, or metadata")
    preserved_v3_annotation = v3_after[2][1]["annotations"]["RL01"]
    if preserved_v3_annotation.get("scoring_protocol") != "integrated-presence-v1":
        raise SystemExit("v3 integrated row lost its scoring protocol")
    if preserved_v3_annotation.get("object_score_reasons") != {"figure": None, "table": None, "equation": None}:
        raise SystemExit("v3 integrated row lost its object score reasons")

    migrate(conn)
    if config(conn) != expected_config(v4):
        raise SystemExit("reapplying the v4 migration changed its config")
    if snapshot(conn, v2_name) != v2_after or snapshot(conn, v3_name) != v3_after:
        raise SystemExit("reapplying the migration changed existing records or history")

    # Unknown or malformed config tuples must fail closed and leave both
    # participant data and the unrecognized config value untouched by rollback.
    drift_cases = (
        (
            "unknown guidance version",
            "UPDATE xacl_private.study_config SET guidance_version=%s WHERE study_id=%s",
            ("unknown-guidance", study_id),
            "unknown",
        ),
        (
            "recognized v2 version with the wrong hash",
            "UPDATE xacl_private.study_config SET guidance_version=%s, guidance_sha256=%s WHERE study_id=%s",
            (v2[0], "8" * 64, study_id),
            "unknown",
        ),
        (
            "recognized v3 version with the wrong hash",
            "UPDATE xacl_private.study_config SET guidance_version=%s, guidance_sha256=%s WHERE study_id=%s",
            (v3[0], "7" * 64, study_id),
            "unknown",
        ),
        (
            "v4 guidance hash mismatch",
            "UPDATE xacl_private.study_config SET guidance_sha256=%s WHERE study_id=%s",
            ("6" * 64, study_id),
            "unknown",
        ),
        (
            "manifest mismatch",
            "UPDATE xacl_private.study_config SET manifest_sha256=%s WHERE study_id=%s",
            ("9" * 64, study_id),
            "frozen dataset",
        ),
        (
            "rubric mismatch",
            "UPDATE xacl_private.study_config SET rubric_version=%s WHERE study_id=%s",
            ("alignment-rubric-v0", study_id),
            "frozen dataset",
        ),
    )
    for label, update_sql, params, expected_error in drift_cases:
        conn.execute(update_sql, params)
        drifted = config(conn)
        try:
            migrate(conn)
        except psycopg.Error as exc:
            conn.execute("ROLLBACK")
            if expected_error not in str(exc).lower():
                raise
        else:
            raise SystemExit(f"migration unexpectedly accepted {label}")

        if config(conn) != drifted:
            raise SystemExit(f"failed migration did not roll back its work for {label}")
        if snapshot(conn, v2_name) != v2_after or snapshot(conn, v3_name) != v3_after:
            raise SystemExit(f"failed migration changed existing participant data for {label}")
        conn.execute(
            "UPDATE xacl_private.study_config SET dataset_id=%s, manifest_sha256=%s, rubric_version=%s, "
            "guidance_version=%s, guidance_sha256=%s WHERE study_id=%s",
            (study_id, manifest, rubric, *v4, study_id),
        )

    migrate(conn)
    if config(conn) != expected_config(v4):
        raise SystemExit("disposable database did not return to the exact v4 config")
    if snapshot(conn, v2_name) != v2_after or snapshot(conn, v3_name) != v3_after:
        raise SystemExit("final idempotent migration changed records/history")

print("PASS: exact v2 and v3 configs upgrade to v4; both legacy participant bindings, records and histories remain unchanged; v4 reapply is idempotent; unknown and malformed config drift fail closed and roll back.")
