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
writing_lock = json.loads((root / "writing-assets.json").read_text())
for name, expected in writing_lock["files"].items():
    if hashlib.sha256((site / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f"Writing protocol asset mismatch: {name}")


def verify_protocol(protocol_id, protocol_config, protocol_lock):
    contract = json.loads((site / f"protocols/{protocol_id}/protocol.json").read_text())
    assert protocol_config["protocol_id"] == protocol_lock["protocol_id"] == contract["protocol_id"] == protocol_id
    assert protocol_config["record_schema"] == contract["record_schema"]
    assert protocol_config["sample_rubric_version"] == manifest["rubric_version"] == "alignment-rubric-v1"
    assert protocol_config["manifest_sha256"] == config["manifest_sha256"]
    for kind in ("rubric", "guidance"):
        path = f"protocols/{protocol_id}/{kind}.json"
        asset = json.loads((site / path).read_text())
        assert protocol_config[f"{kind}_path"] == path
        assert protocol_config[f"{kind}_version"] == asset["version"] == contract[f"{kind}_version"]
        assert protocol_config[f"{kind}_sha256"] == protocol_lock["files"][path] == contract[f"{kind}_sha256"]
        assert asset["protocol_id"] == protocol_id
    rubric = json.loads((site / protocol_config["rubric_path"]).read_text())
    assert [d["key"] for d in rubric["dimensions"]] == contract["score_keys"]
    assert [d["key"] for d in rubric["dimensions"] if d["allows_na"]] == contract["na_keys"]
    assert [d["key"] for d in rubric["version_difference_flags"]] == contract["version_difference_keys"]
    return contract, rubric


archive_config = json.loads((site / "protocols/document-quality-v1/config.json").read_text())
assert archive_config["schema"] == "xacl.hosted-config.v2"
old_contract, old_rubric = verify_protocol("document-quality-v1", archive_config, quality_lock)
assert len(old_rubric["dimensions"]) == 6
assert old_contract["na_keys"] == ["technical_presentation"]
assert config["schema"] == "xacl.hosted-config.v3"
contract, rubric = verify_protocol("latex-writing-quality-v1", config, writing_lock)
assert len(rubric["dimensions"]) == 5 and contract["na_keys"] == []
assert "visual_integrity" not in contract["score_keys"]
assert [flag["key"] for flag in rubric["visual_issue_flags"]] == contract["visual_issue_keys"]
assert rubric["auxiliary_pdf_visual_integrity"]["included_in_core_scores"] is False
assert contract["pdf_visual_shape"]["not_assessed"] == {"score": None, "issue_codes": []}
assert (root / "docs/latex-writing-quality-v1/rubric.json").read_bytes() == (site / config["rubric_path"]).read_bytes()
assert config["supabase_publishable_key"].startswith("sb_publishable_")
assert config["auth_mode"] == "anonymous_recovery_v1"
assert (site / "vendor/supabase/supabase.js").is_file()
assert "sb_secret_" not in (site / "config.json").read_text()
assert len(list((site / "pdfs").rglob("*.pdf"))) == 60
for name in ["index.html", "app.js", "cloud.mjs", "score-protocol.mjs", "quality-protocol.mjs", "writing-protocol.mjs", "styles.css", "vendor/pdfjs/legacy/build/pdf.mjs", "vendor/pdfjs/legacy/build/pdf.worker.mjs"]:
    assert (site / name).is_file(), name
assert not (site / "outputs").exists()
print("Verified frozen cohort and 60 PDFs, both previous protocol archives, and five writing scores with a separate optional visual check.")
