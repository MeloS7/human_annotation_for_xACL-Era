#!/usr/bin/env python3
"""Ensure the coordinator's SQL setup bundle matches the reviewed migration."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = b"""-- xACL-Era Supabase schema setup; creates no participant identities or secrets.
-- Execute once in the Supabase SQL editor as the project database owner.
-- Anonymous sign-in must be enabled in Supabase Auth before launching the site.

"""
expected = HEADER + (ROOT / "supabase/001_annotation.sql").read_bytes()
actual = (ROOT / "supabase/setup.sql").read_bytes()
if actual != expected:
    raise SystemExit(
        "supabase/setup.sql is stale: regenerate it from supabase/001_annotation.sql"
    )
print("PASS: setup.sql exactly bundles the schema migration; it provisions no identities.")
