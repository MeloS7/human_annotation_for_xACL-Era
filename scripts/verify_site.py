#!/usr/bin/env python3
"""Verify the unchanged frozen cohort and runtime assets before deployment."""
import hashlib
import json
import re
from collections import Counter
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
for name in ["human-instructions.txt", "rubric-for-raters.md"]:
    assert (root / f"docs/{protocol_id}/{name}").is_file()
raters_text = (root / f"docs/{protocol_id}/rubric-for-raters.md").read_text()
for dimension in rubric["dimensions"]:
    assert dimension["label"] in raters_text
    assert all(anchor in raters_text for anchor in dimension["scale"].values())
annotation_readme = (root / "README.md").read_text()
protocol_readme = (root / f"docs/{protocol_id}/README.md").read_text()
judge_prompt_url = "https://github.com/MeloS7/revision-lens/tree/g5k/pilot/prompts/latex-data-usability-v1/judge-user-v3"
judge_workflow_url = "https://github.com/MeloS7/revision-lens/blob/g5k/pilot/docs/llm_judge.md"
for document in [annotation_readme, protocol_readme]:
    assert judge_prompt_url in document
    assert judge_workflow_url in document
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

followup = site / "followup49"
followup_config = json.loads((followup / "config.json").read_bytes())
followup_manifest = json.loads((followup / "manifest.json").read_bytes())
followup_guidance = json.loads((followup / "guidance.json").read_bytes())
assert followup_config["study_id"] == config["study_id"]
assert followup_config["dataset_id"] == followup_manifest["dataset_id"] == "revisionlens-low-score49-v1"
assert followup_config["protocol_id"] == "latex-data-usability-followup49-v1"
assert followup_config["record_schema"] == "xacl.low-score-followup-annotations.v1"
assert followup_config["guidance_version"] == followup_guidance["version"]
assert followup_config["rubric_version"] == config["rubric_version"]
assert followup_config["rubric_sha256"] == config["rubric_sha256"]
for name in ("manifest", "guidance"):
    assert hashlib.sha256((followup / f"{name}.json").read_bytes()).hexdigest() == followup_config[f"{name}_sha256"]
assert re.fullmatch(r"[a-f0-9]{64}", followup_config["evidence_sha256"])
papers = followup_manifest["papers"]
assert len(papers) == len({p["sample_id"] for p in papers}) == len({p["paper_id"] for p in papers}) == 49
assert {p["sample_id"] for p in papers}.isdisjoint({p["sample_id"] for p in manifest["papers"]})
assert Counter(p["priority"] for p in papers) == {"priority": 29, "secondary": 20}
assert papers == sorted(papers, key=lambda p: (p["priority"] != "priority", p["sample_id"]))
issue_counts = Counter()
for paper in papers:
    sid = paper["sample_id"]
    pdf = paper["compiled_pdf"]
    issues = [item["id"] for item in paper["issues"]]
    assert re.fullmatch(r"J[0-9]{3}", sid) and pdf["file"] == f"{sid}.pdf"
    assert re.fullmatch(r"[a-f0-9]{64}", pdf["sha256"]) and pdf["bytes"] > 0
    assert paper["assigned_physical_pages"] == list(range(1, min(9, paper["total_pdf_pages"]) + 1))
    assert issues and len(issues) == len(set(issues))
    issue_counts.update(issues)
assert issue_counts == {"document_structural_integrity": 1, "nontext_asset_integrity": 6,
                        "pdf_visual_integrity": 45, "page_9_coverage": 11}
assert not list(site.rglob("J[0-9][0-9][0-9].pdf"))
assert not list(site.rglob("review-evidence.json"))
assert 'href="./followup.html"' in (site / "index.html").read_text()
for name in ("followup.html", "followup.mjs"):
    assert (site / name).is_file()
print("Verified 49 separate follow-up entries, 63 issue prompts, and absence of private review files in the site artifact.")
