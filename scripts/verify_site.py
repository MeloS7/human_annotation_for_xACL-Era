#!/usr/bin/env python3
"""Verify the unchanged frozen cohort and runtime assets before deployment."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
site = root / "site"
lock = json.loads((root / "frozen-assets.json").read_text())
for name, expected in lock["files"].items():
    actual = hashlib.sha256((site / name).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"Frozen asset mismatch: {name}")
manifest = json.loads((site / "manifest.json").read_text())
config = json.loads((site / "config.json").read_text())
assert len(manifest["papers"]) == 30
assert {p["sample_id"] for p in manifest["papers"]} == {f"RL{i:02d}" for i in range(1, 31)}
assert sum(p["period"] == "early" for p in manifest["papers"]) == 15
assert sum(p["period"] == "late" for p in manifest["papers"]) == 15
assert config["manifest_sha256"] == lock["files"]["manifest.json"]
quality_lock = json.loads((root / "quality-assets.json").read_text())
for name, expected in quality_lock["files"].items():
    if hashlib.sha256((site / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f"Quality protocol asset mismatch: {name}")
contract = json.loads((site / "protocols/document-quality-v1/protocol.json").read_text())
assert config["schema"] == "xacl.hosted-config.v2"
assert config["protocol_id"] == quality_lock["protocol_id"] == contract["protocol_id"] == "document-quality-v1"
assert config["record_schema"] == contract["record_schema"]
assert config["sample_rubric_version"] == manifest["rubric_version"] == "alignment-rubric-v1"
for kind in ("rubric", "guidance"):
    path = f"protocols/document-quality-v1/{kind}.json"
    asset = json.loads((site / path).read_text())
    assert config[f"{kind}_path"] == path
    assert config[f"{kind}_version"] == asset["version"] == contract[f"{kind}_version"]
    assert config[f"{kind}_sha256"] == quality_lock["files"][path] == contract[f"{kind}_sha256"]
    assert asset["protocol_id"] == config["protocol_id"]
rubric = json.loads((site / config["rubric_path"]).read_text())
assert [d["key"] for d in rubric["dimensions"]] == contract["score_keys"]
assert len(rubric["dimensions"]) == 6
assert [d["key"] for d in rubric["dimensions"] if d["allows_na"]] == ["technical_presentation"]
assert [d["key"] for d in rubric["version_difference_flags"]] == contract["version_difference_keys"]
assert config["supabase_publishable_key"].startswith("sb_publishable_")
assert config["auth_mode"] == "anonymous_recovery_v1"
assert (site / "vendor/supabase/supabase.js").is_file()
assert "sb_secret_" not in (site / "config.json").read_text()
assert len(list((site / "pdfs").rglob("*.pdf"))) == 60
for name in ["index.html", "app.js", "cloud.mjs", "score-protocol.mjs", "styles.css", "vendor/pdfjs/legacy/build/pdf.mjs", "vendor/pdfjs/legacy/build/pdf.worker.mjs"]:
    assert (site / name).is_file(), name
assert not (site / "outputs").exists()
print("Verified frozen 30-paper cohort, 60 PDFs, unchanged alignment assets, and separately versioned six-dimension quality assets.")
