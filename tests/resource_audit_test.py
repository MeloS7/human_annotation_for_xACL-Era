#!/usr/bin/env python3
"""Focused tests for frozen provenance and safe resource inventory behavior."""

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_resource_audit import AuditError, build_audit, sha256_bytes  # noqa: E402


def dump(path: Path, value: object) -> bytes:
    data = json.dumps(value, separators=(",", ":")).encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


class ResourceAuditTests(unittest.TestCase):
    def fixture(self, temp: Path):
        root = temp / "project"
        catalog_path = root / "catalog.jsonl"
        source = root / "sources" / "paper-one"
        source.mkdir(parents=True)
        archive = root / "archive.body"
        archive.write_bytes(b"frozen source archive")
        main = source / "main.tex"
        main.write_text(r"\documentclass{article}\begin{document}Hello\end{document}")
        figure = source / "fig" / "plot.pdf"
        figure.parent.mkdir()
        figure.write_bytes(b"%PDF-1.4 fixture figure")
        target_pdf = root / "compiled.pdf"
        target_pdf.write_bytes(b"%PDF-1.4 compiled target")

        paper_id = "paper.1"
        catalog_row = {
            "selected_vN": "2401.00001v1",
            "source_archive_ref": {
                "path": "archive.body",
                "bytes": archive.stat().st_size,
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            },
            "derived_source_root_project_relative": "sources/paper-one",
            "actual_main_project_relative": "sources/paper-one/main.tex",
            "author_main_member_ref": {"member": "main.tex", "sha256": hashlib.sha256(main.read_bytes()).hexdigest()},
            "pdf_ref": {
                "path": "compiled.pdf",
                "bytes": target_pdf.stat().st_size,
                "sha256": hashlib.sha256(target_pdf.read_bytes()).hexdigest(),
            },
        }
        catalog_lines = []
        manifest_papers = []
        for number in range(1, 31):
            current_id = f"paper.{number}"
            row = {**catalog_row, "paper_id": current_id, "selected_vN": f"2401.{number:05d}v1"}
            catalog_lines.append(json.dumps(row, separators=(",", ":")).encode() + b"\n")
            manifest_papers.append(
                {
                    "sample_id": f"RL{number:02d}",
                    "paper_id": current_id,
                    "selected_vN": row["selected_vN"],
                    "compiled_pdf": {
                        "sha256": row["pdf_ref"]["sha256"],
                        "bytes": row["pdf_ref"]["bytes"],
                    },
                }
            )
        line = b"".join(catalog_lines)
        catalog_path.write_bytes(line)
        manifest = {
            "dataset_id": "fixture",
            "sampling_provenance_sha256": "PENDING",
            "papers": manifest_papers,
        }
        provenance = {
            "input_refs": {
                "catalog_ref": {
                    "path": "catalog.jsonl",
                    "bytes": len(line),
                    "sha256": hashlib.sha256(line).hexdigest(),
                }
            }
        }
        prov_bytes = dump(root / "sampling-provenance.json", provenance)
        provenance["_source_sha256"] = hashlib.sha256(prov_bytes).hexdigest()
        manifest["sampling_provenance_sha256"] = provenance["_source_sha256"]
        manifest["_source_sha256"] = "1" * 64
        return root, catalog_path, manifest, provenance, main, figure

    def test_inventory_is_hash_bound_and_reports_only_present_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root, catalog, manifest, provenance, _, _ = self.fixture(Path(directory))
            report = build_audit(manifest=manifest, provenance=provenance, project_root=root, catalog_path=catalog)
            self.assertEqual(report["schema"], "xacl.nontext-resource-audit.v1")
            self.assertEqual(report["manifest_sha256"], "1" * 64)
            entry = report["papers"]["RL01"]
            self.assertEqual(entry["status"], "verified_inventory")
            self.assertEqual(entry["source_binding"]["status"], "verified")
            self.assertEqual(entry["assets"][0]["source_path"], "fig/plot.pdf")
            self.assertEqual(entry["assets"][0]["openability"], "not_checked")
            self.assertIn("active TeX include/conditional graph", " ".join(entry["limitations"]))

    def test_catalog_hash_drift_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root, catalog, manifest, provenance, _, _ = self.fixture(Path(directory))
            catalog.write_bytes(catalog.read_bytes() + b"\n")
            with self.assertRaisesRegex(AuditError, "catalog bytes/hash"):
                build_audit(manifest=manifest, provenance=provenance, project_root=root, catalog_path=catalog)

    def test_main_source_hash_mismatch_is_marked_and_not_scored_as_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            root, catalog, manifest, provenance, main, _ = self.fixture(Path(directory))
            main.write_text("changed")
            report = build_audit(manifest=manifest, provenance=provenance, project_root=root, catalog_path=catalog)
            entry = report["papers"]["RL01"]
            self.assertEqual(entry["status"], "partial")
            self.assertEqual(entry["source_binding"]["status"], "mismatch")
            self.assertTrue(any("main LaTeX file" in item for item in entry["limitations"]))

    def test_symlink_escape_is_not_followed_as_an_asset(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root, catalog, manifest, provenance, _, _ = self.fixture(Path(directory))
            outside_file = Path(outside) / "secret.png"
            outside_file.write_bytes(b"outside")
            link = root / "sources" / "paper-one" / "fig" / "escape.png"
            link.symlink_to(outside_file)
            report = build_audit(manifest=manifest, provenance=provenance, project_root=root, catalog_path=catalog)
            names = {asset["source_path"] for asset in report["papers"]["RL01"]["assets"]}
            self.assertEqual(names, {"fig/escape.png", "fig/plot.pdf"})
            escape = next(asset for asset in report["papers"]["RL01"]["assets"] if asset["source_path"] == "fig/escape.png")
            self.assertEqual(escape["availability"], "unknown")

    def test_sampling_provenance_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root, catalog, manifest, provenance, _, _ = self.fixture(Path(directory))
            manifest["sampling_provenance_sha256"] = "0" * 64
            with self.assertRaisesRegex(AuditError, "does not bind"):
                build_audit(manifest=manifest, provenance=provenance, project_root=root, catalog_path=catalog)

    def test_missing_source_root_is_reported_as_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            root, catalog, manifest, provenance, _, _ = self.fixture(Path(directory))
            rows = [json.loads(line) for line in catalog.read_text().splitlines()]
            rows[0]["derived_source_root_project_relative"] = None
            lines = b"".join(json.dumps(row, separators=(",", ":")).encode() + b"\n" for row in rows)
            catalog.write_bytes(lines)
            provenance["input_refs"]["catalog_ref"]["bytes"] = len(lines)
            provenance["input_refs"]["catalog_ref"]["sha256"] = hashlib.sha256(lines).hexdigest()
            provenance_bytes = json.dumps(
                {key: value for key, value in provenance.items() if key != "_source_sha256"},
                separators=(",", ":"),
            ).encode()
            provenance["_source_sha256"] = hashlib.sha256(provenance_bytes).hexdigest()
            manifest["sampling_provenance_sha256"] = provenance["_source_sha256"]
            entry = build_audit(manifest=manifest, provenance=provenance, project_root=root, catalog_path=catalog)["papers"]["RL01"]
            self.assertEqual(entry["status"], "unavailable")
            self.assertEqual(entry["source_binding"]["status"], "unknown")
            self.assertTrue(any("source directory inventory is unavailable" in item for item in entry["limitations"]))

    def test_unsafe_source_archive_and_main_paths_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root, catalog, manifest, provenance, _, _ = self.fixture(Path(directory))
            rows = [json.loads(line) for line in catalog.read_text().splitlines()]
            rows[0]["source_archive_ref"]["path"] = "../../outside.body"
            rows[0]["actual_main_project_relative"] = "../../outside.tex"
            lines = b"".join(json.dumps(row, separators=(",", ":")).encode() + b"\n" for row in rows)
            catalog.write_bytes(lines)
            provenance["input_refs"]["catalog_ref"]["bytes"] = len(lines)
            provenance["input_refs"]["catalog_ref"]["sha256"] = hashlib.sha256(lines).hexdigest()
            provenance_bytes = json.dumps(
                {key: value for key, value in provenance.items() if key != "_source_sha256"},
                separators=(",", ":"),
            ).encode()
            provenance["_source_sha256"] = hashlib.sha256(provenance_bytes).hexdigest()
            manifest["sampling_provenance_sha256"] = provenance["_source_sha256"]
            entry = build_audit(manifest=manifest, provenance=provenance, project_root=root, catalog_path=catalog)["papers"]["RL01"]
            self.assertEqual(entry["status"], "partial")
            self.assertEqual(entry["source_binding"]["status"], "unknown")
            self.assertIsNone(entry["source_binding"]["source_archive_sha256"])
            self.assertIsNone(entry["source_binding"]["main_sha256"])


if __name__ == "__main__":
    unittest.main()
