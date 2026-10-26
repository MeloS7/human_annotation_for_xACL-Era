#!/usr/bin/env python3
"""Ensure the quality setup bundle exactly matches its additive migration."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = b"""-- xACL-Era document-quality v1 database setup.
-- Requires supabase/001_annotation.sql to be installed first.
-- Execute as the project database owner (normally `postgres`).

"""
expected = HEADER + (ROOT / "supabase/002_document_quality.sql").read_bytes()
actual = (ROOT / "supabase/setup-quality.sql").read_bytes()
if actual != expected:
    raise SystemExit(
        "supabase/setup-quality.sql is stale: regenerate it from supabase/002_document_quality.sql"
    )
print("PASS: setup-quality.sql exactly bundles the additive quality migration.")
