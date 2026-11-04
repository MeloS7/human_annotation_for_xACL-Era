#!/usr/bin/env python3
"""Check that the owner-facing setup SQL exactly bundles migration 004."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = b"""-- xACL-Era first-nine-pages LaTeX writing quality protocol setup.
-- Requires migrations 001_annotation.sql, 002_document_quality.sql, and 003_latex_writing.sql.
-- Execute as the project database owner (normally `postgres`).

"""
expected = HEADER + (ROOT / "supabase/004_writing9p.sql").read_bytes()
actual = (ROOT / "supabase/setup-writing9p.sql").read_bytes()
if actual != expected:
    raise SystemExit("setup-writing9p.sql is stale; regenerate it from 004_writing9p.sql")

contract = json.loads(
    (ROOT / "site/protocols/latex-writing-quality-9p-v1/protocol.json").read_text()
)
if contract["protocol_id"] != "latex-writing-quality-9p-v1":
    raise SystemExit("nine-page protocol identifier is not the expected isolated protocol")
for placeholder in ("__NINEPAGE_RUBRIC_SHA256__", "__NINEPAGE_GUIDANCE_SHA256__"):
    if placeholder.encode() in actual:
        raise SystemExit(f"Migration has unresolved asset hash placeholder: {placeholder}")
print("PASS: setup-writing9p.sql exactly bundles migration 004 and its hashes are resolved.")
