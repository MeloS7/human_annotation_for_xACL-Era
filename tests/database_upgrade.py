#!/usr/bin/env python3
"""Exercise the v2-to-v3 database upgrade on a disposable database only."""
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
legacy_name = "QA_UPGRADE_V2"
manifest = "d60e722740919ee30896e2c4a84df256970c0b67c36e831af18a3a68ed3df071"
old_guidance = "alignment-guidance-20261022-v2"
old_hash = "7f8a3b46025dad152afb78e5da5bdd8c068270375e545f300b97da2d134000d3"
new_guidance = "alignment-guidance-20261024-v3"
new_hash = "3ab9433b66c448f211567717ce21df356892956d5f55d5a9adb4a1830340d990"
now = "2026-10-24T12:00:00.000Z"

legacy_annotation = {
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
    "evidence": "Legacy v2 fixture; must remain byte-for-byte represented as v1 JSON.",
    "notes": "",
    "flags": [],
    "reviewed_full_scope": False,
    "status": "draft",
    "updated_at": now,
}
legacy_record = {
    "schema": "revisionlens.alignment-annotations.v1",
    "dataset_id": study_id,
    "manifest_sha256": manifest,
    "rubric_version": "alignment-rubric-v1",
    "annotator_id": legacy_name,
    "revision": 1,
    "created_at": now,
    "updated_at": now,
    "annotations": {"RL01": legacy_annotation},
}


def migrate(conn):
    # Simple-query mode accepts the migration's explicit BEGIN/COMMIT and its
    # complete function bodies without splitting SQL at embedded semicolons.
    conn.execute(migration, prepare=False)


def snapshot(conn):
    current = conn.execute(
        "SELECT revision, current_record, guidance_version, guidance_sha256, saved_at "
        "FROM xacl_private.annotation_records WHERE study_id=%s AND annotator_id=%s",
        (study_id, legacy_name),
    ).fetchone()
    history = conn.execute(
        "SELECT history_id, revision, full_record, guidance_version, guidance_sha256, operation, saved_at "
        "FROM xacl_private.annotation_history WHERE study_id=%s AND annotator_id=%s",
        (study_id, legacy_name),
    ).fetchall()
    return current, history


with psycopg.connect(dsn, autocommit=True) as conn:
    conn.execute("SET client_encoding TO UTF8")
    config = conn.execute(
        "SELECT dataset_id, manifest_sha256, rubric_version, guidance_version, guidance_sha256 "
        "FROM xacl_private.study_config WHERE study_id=%s",
        (study_id,),
    ).fetchone()
    if config != (study_id, manifest, "alignment-rubric-v1", new_guidance, new_hash):
        raise SystemExit(f"Test database must start at the current v3 config, got {config!r}")

    # Seed a realistic legacy participant/current record/history row, and set
    # only the recognized v2 guidance tuple that the migration is allowed to
    # upgrade. The fixture is deterministic, so this test can be rerun.
    conn.execute(
        "INSERT INTO xacl_private.participants (study_id, annotator_id, recovery_code_sha256) "
        "VALUES (%s, %s, extensions.digest(pg_catalog.convert_to('disposable-fixture', 'UTF8'), 'sha256')) "
        "ON CONFLICT (study_id, annotator_id) DO NOTHING",
        (study_id, legacy_name),
    )
    conn.execute(
        "INSERT INTO xacl_private.annotation_records "
        "(study_id, annotator_id, revision, current_record, guidance_version, guidance_sha256, saved_at) "
        "VALUES (%s, %s, 1, %s, %s, %s, pg_catalog.clock_timestamp()) "
        "ON CONFLICT (study_id, annotator_id) DO UPDATE SET revision=1, current_record=EXCLUDED.current_record, "
        "guidance_version=EXCLUDED.guidance_version, guidance_sha256=EXCLUDED.guidance_sha256, saved_at=EXCLUDED.saved_at",
        (study_id, legacy_name, Jsonb(legacy_record), old_guidance, old_hash),
    )
    conn.execute(
        "INSERT INTO xacl_private.annotation_history "
        "(study_id, annotator_id, revision, full_record, guidance_version, guidance_sha256, operation, saved_at) "
        "VALUES (%s, %s, 1, %s, %s, %s, 'save', pg_catalog.clock_timestamp()) "
        "ON CONFLICT (study_id, annotator_id, revision) DO NOTHING",
        (study_id, legacy_name, Jsonb(legacy_record), old_guidance, old_hash),
    )
    conn.execute(
        "UPDATE xacl_private.study_config SET guidance_version=%s, guidance_sha256=%s WHERE study_id=%s",
        (old_guidance, old_hash, study_id),
    )
    before_current, before_history = snapshot(conn)
    if before_current is None or len(before_history) != 1:
        raise SystemExit("Could not establish a deterministic v2 legacy record/history fixture")

    migrate(conn)
    upgraded = conn.execute(
        "SELECT guidance_version, guidance_sha256 FROM xacl_private.study_config WHERE study_id=%s",
        (study_id,),
    ).fetchone()
    if upgraded != (new_guidance, new_hash):
        raise SystemExit(f"Known v2 config was not upgraded exactly: {upgraded!r}")
    after_current, after_history = snapshot(conn)
    if after_current != before_current or after_history != before_history:
        raise SystemExit("v2 upgrade rewrote an existing annotation record or history metadata")
    if "scoring_protocol" in after_current[1]["annotations"]["RL01"]:
        raise SystemExit("legacy rating was incorrectly promoted to the integrated protocol")

    migrate(conn)
    if conn.execute(
        "SELECT guidance_version, guidance_sha256 FROM xacl_private.study_config WHERE study_id=%s",
        (study_id,),
    ).fetchone() != (new_guidance, new_hash):
        raise SystemExit("reapplying the migration changed the v3 config")
    if snapshot(conn) != (after_current, after_history):
        raise SystemExit("reapplying the migration changed the existing record or history")

    # Config drift must fail closed and roll back the migration rather than
    # silently blessing data not represented by this site.
    drift_cases = (
        (
            "unknown guidance version",
            "UPDATE xacl_private.study_config SET guidance_version=%s WHERE study_id=%s",
            ("unknown-guidance", study_id),
            "unknown",
        ),
        (
            "guidance hash mismatch",
            "UPDATE xacl_private.study_config SET guidance_sha256=%s WHERE study_id=%s",
            ("8" * 64, study_id),
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
        try:
            migrate(conn)
        except psycopg.Error as exc:
            conn.execute("ROLLBACK")
            if expected_error not in str(exc).lower():
                raise
        else:
            raise SystemExit(f"migration unexpectedly accepted {label}")

        drifted = conn.execute(
            "SELECT dataset_id, manifest_sha256, rubric_version, guidance_version, guidance_sha256 "
            "FROM xacl_private.study_config WHERE study_id=%s",
            (study_id,),
        ).fetchone()
        if snapshot(conn) != (after_current, after_history):
            raise SystemExit(f"failed migration changed the existing record or history for {label}")
        conn.execute(
            "UPDATE xacl_private.study_config SET dataset_id=%s, manifest_sha256=%s, rubric_version=%s, "
            "guidance_version=%s, guidance_sha256=%s WHERE study_id=%s",
            (study_id, manifest, "alignment-rubric-v1", new_guidance, new_hash, study_id),
        )
        if drifted == (study_id, manifest, "alignment-rubric-v1", new_guidance, new_hash):
            raise SystemExit(f"drift fixture did not alter metadata for {label}")

    # Return the disposable DB to its expected state for subsequent contract
    # and RLS tests in the same run.
    conn.execute(
        "UPDATE xacl_private.study_config SET guidance_version=%s, guidance_sha256=%s WHERE study_id=%s",
        (new_guidance, new_hash, study_id),
    )
    migrate(conn)

print("PASS: known v2 config upgrades; legacy record/history are preserved; reapply is idempotent; unknown guidance, manifest, and rubric drift fail closed.")
