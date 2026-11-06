#!/usr/bin/env python3
"""Check the pinned follow-up protocol metadata and SQL issue allowlist."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "site/followup49"
CONFIG = json.loads((ASSET_DIR / "config.json").read_text())
MANIFEST_BYTES = (ASSET_DIR / "manifest.json").read_bytes()
GUIDANCE_BYTES = (ASSET_DIR / "guidance.json").read_bytes()
MANIFEST = json.loads(MANIFEST_BYTES)
MIGRATION = (ROOT / "supabase/006_followup49.sql").read_text()

EXPECTED_CONFIG = {
    "schema": "xacl.followup49-config.v1",
    "study_id": "revisionlens-alignment30-v1",
    "dataset_id": "revisionlens-low-score49-v1",
    "protocol_id": "latex-data-usability-followup49-v1",
    "record_schema": "xacl.low-score-followup-annotations.v1",
    "manifest_sha256": "52cc838fe1e2ad4dc1f5b40beb972913492902cacdc8edae206fc2c1606d652f",
    "rubric_version": "latex-data-usability-rubric-v1",
    "rubric_sha256": "25936187e5e55acdc4783b6cf597b7792fba7efe3ea4a093e03c40caaf0e86c0",
    "guidance_version": "low-score-followup-guidance-v1",
    "guidance_sha256": "e5d3da508ae113a86114ba365c8fca3878d2fbe5f7f0efa26a1a6efa56ef218d",
}

assert CONFIG == {**EXPECTED_CONFIG, "evidence_sha256": CONFIG.get("evidence_sha256")}, CONFIG
assert hashlib.sha256(MANIFEST_BYTES).hexdigest() == CONFIG["manifest_sha256"]
assert hashlib.sha256(GUIDANCE_BYTES).hexdigest() == CONFIG["guidance_sha256"]
assert MANIFEST["dataset_id"] == CONFIG["dataset_id"]
assert len(MANIFEST["papers"]) == 49

expected_issues: set[tuple[str, str]] = set()
expected_samples: set[str] = set()
allowed_issue_ids = {
    "text_integrity_readability",
    "document_structural_integrity",
    "nontext_asset_integrity",
    "overall_data_usability",
    "pdf_visual_integrity",
    "page_9_coverage",
}
for paper in MANIFEST["papers"]:
    sample_id = paper["sample_id"]
    assert re.fullmatch(r"J\d{3}", sample_id), sample_id
    assert sample_id not in expected_samples, sample_id
    expected_samples.add(sample_id)
    paper_issue_ids = [issue["id"] for issue in paper["issues"]]
    assert paper_issue_ids, f"paper {sample_id} must have at least one issue"
    assert len(paper_issue_ids) == len(set(paper_issue_ids)), sample_id
    for issue_id in paper_issue_ids:
        assert issue_id in allowed_issue_ids, (sample_id, issue_id)
        expected_issues.add((sample_id, issue_id))
assert len(expected_samples) == 49
assert len(expected_issues) == 63
allowlist_sha256 = hashlib.sha256(
    "\n".join(f"{sample_id}\t{issue_id}" for sample_id, issue_id in sorted(expected_issues)).encode()
).hexdigest()

seed_match = re.search(
    r"INSERT INTO _followup49_expected_issues \(sample_id, issue_id\) VALUES(.*?);",
    MIGRATION,
    flags=re.DOTALL,
)
assert seed_match, "migration must embed a generated issue allowlist"
seeded_issues = set(re.findall(r"\('(J\d{3})', '([a-z0-9_]+)'\)", seed_match.group(1)))
assert seeded_issues == expected_issues, {
    "missing": sorted(expected_issues - seeded_issues),
    "extra": sorted(seeded_issues - expected_issues),
}
assert allowlist_sha256 in MIGRATION, "runtime health check must pin the exact issue allowlist"

required_rpcs = {
    "xacl_followup49_annotation_health",
    "xacl_followup49_register_annotator",
    "xacl_followup49_resume_annotator",
    "xacl_followup49_current_annotations",
    "xacl_followup49_load_annotations",
    "xacl_followup49_save_annotations",
}
for rpc_name in required_rpcs:
    assert f"FUNCTION public.{rpc_name}(" in MIGRATION, rpc_name
    assert f"REVOKE ALL ON FUNCTION public.{rpc_name}" in MIGRATION, rpc_name
    assert f"GRANT EXECUTE ON FUNCTION public.{rpc_name}" in MIGRATION, rpc_name

assert "DROP FUNCTION" not in MIGRATION.upper()
assert "DROP TABLE" not in MIGRATION.upper()
assert "52cc838fe1e2ad4dc1f5b40beb972913492902cacdc8edae206fc2c1606d652f" in MIGRATION
assert "e5d3da508ae113a86114ba365c8fca3878d2fbe5f7f0efa26a1a6efa56ef218d" in MIGRATION
assert "xacl.followup49-config.v1" not in MIGRATION  # runtime RPC exposes the record schema, not client config internals

print("PASS: follow-up config hashes, 49-paper manifest, and exact per-paper SQL issue allowlist match.")
