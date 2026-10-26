#!/usr/bin/env python3
"""Ensure the writing setup bundle exactly matches migration 003."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = b"""-- xACL-Era LaTeX writing quality v1 database setup.
-- Requires 001_annotation.sql and 002_document_quality.sql first.
-- Execute as the project database owner (normally `postgres`).

"""
expected = HEADER + (ROOT / "supabase/003_latex_writing.sql").read_bytes()
actual = (ROOT / "supabase/setup-writing.sql").read_bytes()
if actual != expected:
    raise SystemExit(
        "supabase/setup-writing.sql is stale: regenerate it from supabase/003_latex_writing.sql"
    )
print("PASS: setup-writing.sql exactly bundles the additive latex-writing-quality migration.")
