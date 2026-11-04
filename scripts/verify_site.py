#!/usr/bin/env python3
"""Verify the unchanged frozen cohort and runtime assets before deployment."""
import hashlib
import json
import re
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
writing9p_lock = json.loads((root / "writing9p-assets.json").read_text())
for name, expected in writing9p_lock["files"].items():
    if hashlib.sha256((site / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f"Nine-page writing asset mismatch: {name}")
usability_lock = json.loads((root / "usability-assets.json").read_text())
for name, expected in usability_lock["files"].items():
    if hashlib.sha256((site / name).read_bytes()).hexdigest() != expected:
        raise SystemExit(f"Data usability asset mismatch: {name}")


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
writing_archive_config = json.loads((site / "protocols/latex-writing-quality-v1/config.json").read_text())
archived_contract, archived_rubric = verify_protocol("latex-writing-quality-v1", writing_archive_config, writing_lock)
assert (root / "docs/latex-writing-quality-v1/rubric.json").read_bytes() == (site / writing_archive_config["rubric_path"]).read_bytes()
writing9p_archive_config = json.loads((site / "protocols/latex-writing-quality-9p-v1/config.json").read_text())
old9p_contract, old9p_rubric = verify_protocol("latex-writing-quality-9p-v1", writing9p_archive_config, writing9p_lock)
assert len(old9p_rubric["dimensions"]) == 5 and old9p_contract["na_keys"] == []
assert (root / "docs/latex-writing-quality-9p-v1/rubric.json").read_bytes() == (site / writing9p_archive_config["rubric_path"]).read_bytes()
protocol_id = "latex-data-usability-v1"
contract, rubric = verify_protocol(protocol_id, config, usability_lock)
assert contract["score_keys"] == ["text_integrity_readability", "document_structural_integrity", "nontext_asset_integrity", "overall_data_usability"]
assert len(rubric["dimensions"]) == 4 and contract["na_keys"] == ["nontext_asset_integrity"]
assert all(d["scale"].keys() == {"1", "2", "3", "4", "5"} for d in rubric["dimensions"])
assert "visual_integrity" not in contract["score_keys"]
assert [flag["key"] for flag in rubric["visual_issue_flags"]] == contract["visual_issue_keys"]
assert rubric["auxiliary_pdf_visual_integrity"]["included_in_core_scores"] is False
assert contract["pdf_visual_shape"]["not_assessed"] == {"score": None, "issue_codes": []}
assert (root / f"docs/{protocol_id}/rubric.json").read_bytes() == (site / config["rubric_path"]).read_bytes()
scope = contract["scope_policy"]
assert scope == rubric["scope_policy"]
assert scope["scope_id"] == "target-pdf-first9-maintext-v1"
assert scope["page_numbering"] == "physical_pdf_pages_1_based"
assert scope["first_page"] == 1 and scope["last_page_inclusive"] == 9
assert scope["short_pdf_rule"] == "all_existing_pages"
# Preserve the archived first judge transport as well as the active user-only one.
judge_template = json.loads((root / f"docs/{protocol_id}/judge-output-template.json").read_text())
assert judge_template["protocol_id"] == protocol_id
assert judge_template["rubric_version"] == rubric["version"]
assert judge_template["scope_id"] == scope["scope_id"]
assert judge_template["input_condition"] == "source_plus_pdf_pages_and_resource_report"
assert list(judge_template["core_scores"]) == contract["score_keys"]
assert all(value is None for value in judge_template["core_scores"].values()), "Templates must not be mistaken for ratings"
for name in ["human-instructions.txt", "judge-system.txt", "judge-input-template.md", "rubric-for-raters.md"]:
    assert (root / f"docs/{protocol_id}/{name}").is_file()
raters_text = (root / f"docs/{protocol_id}/rubric-for-raters.md").read_text()
judge_text = (root / f"docs/{protocol_id}/judge-system.txt").read_text()
for dimension in rubric["dimensions"]:
    assert dimension["label"] in raters_text
    assert all(anchor in raters_text for anchor in dimension["scale"].values())
    assert dimension["key"] in judge_text
assert list(judge_template["judge_audit"]) == contract["score_keys"]
active_judge_dir = root / f"docs/{protocol_id}/judge-user-v3"
active_template = json.loads((active_judge_dir / "output-template.json").read_text())
assert list(active_template) == ["core_scores", "pdf_visual_integrity", "limitations"]
assert list(active_template["core_scores"]) == contract["score_keys"]
for entry in [*active_template["core_scores"].values(), active_template["pdf_visual_integrity"]]:
    assert entry == {"score": None, "reason": ""}
assert active_template["limitations"] == []
assert (active_judge_dir / "output-template.json").read_bytes() == (root / f"docs/{protocol_id}/judge-user-v2/output-template.json").read_bytes()
active_prompt = (active_judge_dir / "prompt-template.txt").read_text()
assert set(re.findall(r"\{\{[A-Z_]+\}\}", active_prompt)) == {
    "{{PRIMARY_LATEX}}", "{{PAGE_COUNT}}"
}
for removed_input in ["RESOURCE EVIDENCE", "INPUT LIMITATIONS", "{{RESOURCE_EVIDENCE}}", "{{INPUT_LIMITATIONS}}"]:
    assert removed_input not in active_prompt
for dimension in [*rubric["dimensions"], rubric["auxiliary_pdf_visual_integrity"]]:
    assert dimension["label"] in active_prompt
    assert dimension["definition"] in active_prompt
    assert all(anchor in active_prompt for anchor in dimension["scale"].values())
for key in [*active_template, *contract["score_keys"], "score", "reason"]:
    assert json.dumps(key) in active_prompt
for host_only_key in ["manifest_sha256", "rubric_sha256", "protocol_id", "source_pdf_binding_verified"]:
    assert host_only_key not in active_prompt
assert (active_judge_dir / "README.md").is_file()
guidance = json.loads((site / config["guidance_path"]).read_text())
report_ref = guidance["resource_audit"]
report_path = site / report_ref["path"]
assert report_path.resolve().is_relative_to(site.resolve())
assert report_ref["sha256"] == hashlib.sha256(report_path.read_bytes()).hexdigest()
report = json.loads(report_path.read_text())
assert report["schema"] == "xacl.nontext-resource-audit.v1"
assert report["manifest_sha256"] == config["manifest_sha256"]
assert report["scope_id"] == "whole-target-source-project-inventory-v1"
assert set(report["papers"]) == {p["sample_id"] for p in manifest["papers"]}
for paper in manifest["papers"]:
    entry = report["papers"][paper["sample_id"]]
    assert entry["paper_id"] == paper["paper_id"]
    assert entry["selected_vN"] == paper["selected_vN"]
    assert entry["compiled_pdf_sha256"] == paper["compiled_pdf"]["sha256"]
assert config["supabase_publishable_key"].startswith("sb_publishable_")
assert config["auth_mode"] == "anonymous_recovery_v1"
assert (site / "vendor/supabase/supabase.js").is_file()
assert "sb_secret_" not in (site / "config.json").read_text()
assert len(list((site / "pdfs").rglob("*.pdf"))) == 60
for name in ["index.html", "app.js", "cloud.mjs", "score-protocol.mjs", "quality-protocol.mjs", "writing-protocol.mjs", "writing9p-protocol.mjs", "usability-protocol.mjs", "styles.css", "vendor/pdfjs/legacy/build/pdf.mjs", "vendor/pdfjs/legacy/build/pdf.worker.mjs"]:
    assert (site / name).is_file(), name
assert not (site / "outputs").exists()
print("Verified frozen cohort and 60 PDFs, archived protocols, four shared data-usability ratings, independent visual check and bound source-resource inventory.")
