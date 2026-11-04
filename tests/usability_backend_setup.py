#!/usr/bin/env python3
"""Check the owner-facing data-usability setup bundle and frozen protocol hashes."""
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_DIR = ROOT / "site/protocols/latex-data-usability-v1"
CONTRACT = json.loads((PROTOCOL_DIR / "protocol.json").read_text())
RUBRIC = (PROTOCOL_DIR / "rubric.json").read_bytes()
GUIDANCE = (PROTOCOL_DIR / "guidance.json").read_bytes()
MIGRATION = (ROOT / "supabase/005_data_usability.sql").read_bytes()
HEADER = b"""-- xACL-Era LaTeX data-usability protocol setup.
-- Requires migrations 001_annotation.sql, 002_document_quality.sql, 003_latex_writing.sql, and 004_writing9p.sql.
-- Execute as the project database owner (normally `postgres`).

"""

expected = HEADER + MIGRATION
actual = (ROOT / "supabase/setup-usability.sql").read_bytes()
if actual != expected:
    raise SystemExit("setup-usability.sql is stale; regenerate it from 005_data_usability.sql")

expected_contract = {
    "protocol_id": "latex-data-usability-v1",
    "record_schema": "xacl.latex-data-usability-annotations.v1",
    "rubric_version": "latex-data-usability-rubric-v1",
    "guidance_version": "latex-data-usability-guidance-20261104-v1",
    "rpc_prefix": "xacl_usability_",
    "score_keys": [
        "text_integrity_readability",
        "document_structural_integrity",
        "nontext_asset_integrity",
        "overall_data_usability",
    ],
    "na_keys": ["nontext_asset_integrity"],
}
for key, expected_value in expected_contract.items():
    if CONTRACT.get(key) != expected_value:
        raise SystemExit(f"protocol.json {key} does not match the database contract")

if hashlib.sha256(RUBRIC).hexdigest() != CONTRACT.get("rubric_sha256"):
    raise SystemExit("data-usability rubric hash does not match protocol.json")
if hashlib.sha256(GUIDANCE).hexdigest() != CONTRACT.get("guidance_sha256"):
    raise SystemExit("data-usability guidance hash does not match protocol.json")
for value in (CONTRACT["rubric_sha256"], CONTRACT["guidance_sha256"]):
    if value.encode() not in MIGRATION:
        raise SystemExit("005_data_usability.sql does not pin both canonical asset hashes")
if b"__USABILITY_" in MIGRATION:
    raise SystemExit("005_data_usability.sql contains an unresolved hash placeholder")

scope = CONTRACT.get("scope_policy", {})
if scope.get("first_page") != 1 or scope.get("last_page_inclusive") != 9:
    raise SystemExit("data-usability page scope must remain the frozen physical PDF pages 1-9")

# The new migration must pin, and leave in place, the exact installed 004 archive.
archived_9p = json.loads((ROOT / "site/protocols/latex-writing-quality-9p-v1/config.json").read_text())
for value in (
    archived_9p["protocol_id"],
    archived_9p["record_schema"],
    archived_9p["rubric_version"],
    archived_9p["rubric_sha256"],
    archived_9p["guidance_version"],
    archived_9p["guidance_sha256"],
):
    if value.encode() not in MIGRATION:
        raise SystemExit(f"005_data_usability.sql does not assert archived 004 identity value {value}")

print("PASS: setup-usability.sql exactly bundles migration 005 and the canonical protocol/asset contract.")
