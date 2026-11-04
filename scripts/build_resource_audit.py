#!/usr/bin/env python3
"""Build a hash-bound, read-only inventory of the frozen sample's LaTeX assets.

The inventory is deliberately scoped to each paper's derived source directory.
It does not resolve TeX's active include graph or map assets to the first-nine-
page scoring window, so a complete file inventory is not a completeness claim.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path, PurePosixPath
from typing import Any


SCHEMA = "xacl.nontext-resource-audit.v1"
SCOPE_ID = "whole-target-source-project-inventory-v1"
ASSET_KINDS = {
    ".bmp": "raster_image",
    ".eps": "encapsulated_postscript",
    ".gif": "raster_image",
    ".jpeg": "raster_image",
    ".jpg": "raster_image",
    ".pdf": "pdf_figure",
    ".png": "raster_image",
    ".ps": "postscript_figure",
    ".svg": "vector_image",
    ".tif": "raster_image",
    ".tiff": "raster_image",
    ".webp": "raster_image",
}
MAX_SOURCE_FILES = 20_000


class AuditError(ValueError):
    """A frozen input or path failed closed validation."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def confined_path(root: Path, raw_path: str) -> Path:
    """Resolve a project-relative POSIX path and reject traversal/symlink escapes."""
    relative = PurePosixPath(raw_path)
    if relative.is_absolute() or not raw_path or ".." in relative.parts:
        raise AuditError(f"unsafe project-relative path: {raw_path!r}")
    resolved_root = root.resolve(strict=True)
    candidate = (resolved_root / Path(*relative.parts)).resolve(strict=False)
    try:
        candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise AuditError(f"path escapes project root: {raw_path!r}") from exc
    return candidate


def read_catalog(path: Path) -> tuple[dict[str, dict[str, Any]], str, int]:
    digest = hashlib.sha256()
    rows: dict[str, dict[str, Any]] = {}
    count = 0
    with path.open("rb") as stream:
        for line_number, line in enumerate(stream, 1):
            digest.update(line)
            if not line.strip():
                continue
            row = json.loads(line)
            paper_id = row.get("paper_id")
            if not isinstance(paper_id, str) or paper_id in rows:
                raise AuditError(f"catalog has missing or duplicate paper_id at line {line_number}")
            rows[paper_id] = row
            count += 1
    return rows, digest.hexdigest(), path.stat().st_size


def verify_ref(root: Path, ref: dict[str, Any]) -> tuple[str | None, str]:
    """Return actual hash and outcome, without exposing absolute paths in output."""
    raw_path = ref.get("path")
    expected = ref.get("sha256")
    if not isinstance(raw_path, str) or not isinstance(expected, str):
        return None, "unknown"
    try:
        path = confined_path(root, raw_path)
    except (AuditError, OSError):
        return None, "unknown"
    if not path.is_file():
        return None, "unknown"
    actual = sha256_file(path)
    if actual != expected:
        return actual, "mismatch"
    expected_bytes = ref.get("bytes")
    if expected_bytes is not None and path.stat().st_size != expected_bytes:
        return actual, "mismatch"
    return actual, "verified"


def source_assets(root: Path, raw_source_root: str) -> tuple[list[dict[str, Any]], list[str], int, int]:
    """Inventory supported external visual resources; do not infer they are active."""
    if not isinstance(raw_source_root, str):
        raise AuditError("derived source directory path is absent")
    source_root = confined_path(root, raw_source_root)
    if not source_root.is_dir():
        raise AuditError("derived source directory is unavailable")

    assets: list[dict[str, Any]] = []
    checked_files = 0
    overflow = False
    excluded_symlinks = 0
    unreadable_assets = 0
    scan_errors = 0

    def on_walk_error(_error: OSError) -> None:
        nonlocal scan_errors
        scan_errors += 1

    for current, dirs, filenames in os.walk(source_root, followlinks=False, onerror=on_walk_error):
        current_path = Path(current)
        # Do not follow symlinked directories, including ones that point elsewhere.
        excluded_symlinks += sum(1 for name in dirs if (current_path / name).is_symlink())
        dirs[:] = [name for name in dirs if not (current_path / name).is_symlink()]
        dirs.sort()
        for filename in sorted(filenames):
            candidate = current_path / filename
            checked_files += 1
            if checked_files > MAX_SOURCE_FILES:
                overflow = True
                break
            suffix = candidate.suffix.lower()
            kind = ASSET_KINDS.get(suffix)
            if kind is None:
                continue
            try:
                resolved = candidate.resolve(strict=True)
                resolved.relative_to(source_root.resolve(strict=True))
            except (OSError, ValueError):
                if candidate.is_symlink():
                    excluded_symlinks += 1
                    relative = candidate.relative_to(source_root).as_posix()
                    assets.append(
                        {
                            "source_path": relative,
                            "kind": kind,
                            "representation": "external_file",
                            "availability": "unknown",
                            "openability": "not_checked",
                        }
                    )
                continue
            if not resolved.is_file():
                continue
            relative = candidate.relative_to(source_root).as_posix()
            try:
                assets.append(
                    {
                        "source_path": relative,
                        "kind": kind,
                        "representation": "external_file",
                        "availability": "present",
                        "openability": "not_checked",
                        "sha256": sha256_file(resolved),
                        "bytes": resolved.stat().st_size,
                    }
                )
            except OSError:
                unreadable_assets += 1
                assets.append(
                    {
                        "source_path": relative,
                        "kind": kind,
                        "representation": "external_file",
                        "availability": "unknown",
                        "openability": "not_checked",
                    }
                )
        if overflow:
            break
    assets.sort(key=lambda item: item["source_path"].casefold())
    limitations = []
    if overflow:
        limitations.append(f"Source scan stopped at the {MAX_SOURCE_FILES}-file safety limit.")
    if excluded_symlinks:
        limitations.append(f"{excluded_symlinks} symlinked source paths were skipped or marked unknown.")
    if unreadable_assets:
        limitations.append(f"{unreadable_assets} supported asset files could not be hashed; their availability is unknown.")
    if scan_errors:
        limitations.append(f"{scan_errors} source-directory entries could not be read.")
    return assets, limitations, checked_files, excluded_symlinks


def build_audit(
    *,
    manifest: dict[str, Any],
    provenance: dict[str, Any],
    project_root: Path,
    catalog_path: Path | None = None,
) -> dict[str, Any]:
    project_root = project_root.resolve(strict=True)
    manifest_digest = sha256_bytes(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    )
    # Bind to the exact source bytes when the caller has retained them.
    manifest_digest = manifest.get("_source_sha256", manifest_digest)

    prov_digest = provenance.get("_source_sha256")
    if not isinstance(prov_digest, str):
        raise AuditError("sampling provenance source hash is required")
    if manifest.get("sampling_provenance_sha256") != prov_digest:
        raise AuditError("manifest does not bind to the supplied sampling provenance")

    input_ref = provenance.get("input_refs", {}).get("catalog_ref", {})
    ref_path = input_ref.get("path")
    if catalog_path is None:
        if not isinstance(ref_path, str):
            raise AuditError("catalog path is absent from frozen sampling provenance")
        catalog_path = confined_path(project_root, ref_path)
    else:
        catalog_path = catalog_path.resolve(strict=True)
        try:
            catalog_path.relative_to(project_root)
        except ValueError as exc:
            raise AuditError("catalog path escapes project root") from exc

    if not catalog_path.is_file():
        raise AuditError("frozen source catalog is unavailable")
    rows, catalog_digest, catalog_bytes = read_catalog(catalog_path)
    if catalog_digest != input_ref.get("sha256") or catalog_bytes != input_ref.get("bytes"):
        raise AuditError("catalog bytes/hash differ from the frozen provenance")

    papers = manifest.get("papers")
    if not isinstance(papers, list) or len(papers) != 30:
        raise AuditError("the frozen manifest must contain exactly 30 papers")
    if len({paper.get("sample_id") for paper in papers}) != 30:
        raise AuditError("manifest sample IDs must be unique")

    report_papers: dict[str, dict[str, Any]] = {}
    for paper in papers:
        sample_id = paper.get("sample_id")
        paper_id = paper.get("paper_id")
        row = rows.get(paper_id)
        if not isinstance(sample_id, str) or not isinstance(paper_id, str) or row is None:
            raise AuditError(f"manifest paper {sample_id!r} has no matching frozen source row")

        expected_pdf = paper.get("compiled_pdf", {})
        source_pdf = row.get("pdf_ref", {})
        if (
            expected_pdf.get("sha256") != source_pdf.get("sha256")
            or expected_pdf.get("bytes") != source_pdf.get("bytes")
            or paper.get("selected_vN") != row.get("selected_vN")
        ):
            raise AuditError(f"manifest/source-catalog binding mismatch for {sample_id}")

        source_archive_ref = row.get("source_archive_ref", {})
        main_ref = row.get("author_main_member_ref", {})
        main_path_raw = row.get("actual_main_project_relative")
        main_ref_for_hash = {
            "path": main_path_raw,
            "sha256": main_ref.get("sha256"),
            "bytes": main_ref.get("bytes"),
        }
        archive_hash, archive_status = verify_ref(project_root, source_archive_ref)
        main_hash, main_status = verify_ref(project_root, main_ref_for_hash)

        try:
            source_root_path = confined_path(project_root, row.get("derived_source_root_project_relative"))
            main_path = confined_path(project_root, main_path_raw)
            main_path.relative_to(source_root_path)
        except (AuditError, OSError, TypeError, ValueError):
            main_status = "unknown"
            main_hash = None

        try:
            source_root_raw = row.get("derived_source_root_project_relative")
            assets, scan_limitations, file_count, excluded_symlinks = source_assets(project_root, source_root_raw)
            tree_status = "verified"
        except (AuditError, OSError):
            assets, scan_limitations, file_count, excluded_symlinks, tree_status = [], [], 0, 0, "unavailable"

        pdf_hash, pdf_status = verify_ref(
            project_root,
            {
                "path": source_pdf.get("path"),
                "sha256": source_pdf.get("sha256"),
                "bytes": source_pdf.get("bytes"),
            },
        )
        binding_status = "verified"
        if "mismatch" in (archive_status, main_status, pdf_status):
            binding_status = "mismatch"
        elif "unknown" in (archive_status, main_status, pdf_status) or tree_status != "verified":
            binding_status = "unknown"

        limitations = [
            "Inventory covers the derived source project, not only objects visible on physical PDF pages 1–9.",
            "The active TeX include/conditional graph and source-to-page object mapping were not resolved; listed files may be unused, and unlisted generated objects may still appear in the PDF.",
            "File bytes and hashes were checked; image decoding, pixel legibility, and correspondence to particular PDF objects were not checked.",
            "Tables, equations, TikZ drawings, and other LaTeX-generated objects may have no separate external asset file; inspect the compiled PDF for those objects.",
            "The catalog links the frozen source snapshot and compiled PDF by provenance and hashes; no independent recompilation or visual equivalence audit was performed here.",
        ]
        limitations.extend(scan_limitations)
        if archive_status != "verified":
            limitations.append("The frozen source archive could not be independently verified from its recorded hash.")
        if main_status != "verified":
            limitations.append("The designated main LaTeX file could not be independently verified from its recorded hash.")
        if pdf_status != "verified":
            limitations.append("The compiled PDF on G5K could not be independently verified from its recorded hash.")
        if tree_status != "verified":
            limitations.append("The derived source directory inventory is unavailable.")
        elif scan_limitations:
            limitations.append("The derived source directory inventory is partial because some entries could not be checked.")
        if main_status == "mismatch":
            limitations.append("The designated main LaTeX file differs from the frozen member hash; check whether a recorded build transformation explains the difference.")
        elif main_status == "unknown":
            limitations.append("The designated main LaTeX file could not be safely bound to the derived source directory.")

        if binding_status == "mismatch":
            status = "partial"
        elif binding_status == "unknown" or scan_limitations:
            status = "unavailable" if tree_status != "verified" and not assets else "partial"
        else:
            # Complete hash/path inventory, with its narrower scope stated above.
            status = "verified_inventory"

        report_papers[sample_id] = {
            "paper_id": paper_id,
            "selected_vN": paper["selected_vN"],
            "compiled_pdf_sha256": expected_pdf["sha256"],
            "status": status,
            "source_binding": {
                "status": binding_status,
                "source_archive_sha256": archive_hash,
                "main_sha256": main_hash,
            },
            "assets": assets,
            "limitations": limitations,
            "inventory_file_count": file_count,
            "catalog_pdf_sha256": pdf_hash,
            "excluded_symlink_count": excluded_symlinks,
        }

    return {
        "schema": SCHEMA,
        "manifest_sha256": manifest_digest,
        "scope_id": SCOPE_ID,
        "catalog_sha256": catalog_digest,
        "papers": report_papers,
    }


def load_source_json(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    result = json.loads(data)
    if not isinstance(result, dict):
        raise AuditError(f"expected JSON object: {path}")
    result["_source_sha256"] = sha256_bytes(data)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--provenance", type=Path)
    parser.add_argument("--context-stdin", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    if args.context_stdin:
        context = globals().get("RESOURCE_AUDIT_CONTEXT")
        if not isinstance(context, dict):
            raise AuditError("--context-stdin requires the parent process to inject frozen JSON context")
        manifest = dict(context["manifest"])
        provenance = dict(context["provenance"])
    else:
        if not args.manifest or not args.provenance:
            parser.error("--manifest and --provenance are required unless using --context-stdin")
        manifest = load_source_json(args.manifest)
        provenance = load_source_json(args.provenance)

    report = build_audit(
        manifest=manifest,
        provenance=provenance,
        project_root=args.project_root,
    )
    output = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AuditError, OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"resource audit failed: {exc}") from exc
