#!/usr/bin/env python3
"""Build an offline, single-user multimodal judge request from a prepared packet.

This script validates packet shape and image files; it does not compile/execute
LaTeX, verify source-to-PDF binding, choose a model/provider, or call an API.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DOC_DIR = ROOT / "docs/latex-data-usability-v1"
PROMPT_DIR = DOC_DIR / "judge-user-v3"
PROTOCOL_DIR = ROOT / "site/protocols/latex-data-usability-v1"
PROMPT_VERSION = "judge-user-v3"
PROTOCOL_ID = "latex-data-usability-v1"
SCOPE_ID = "target-pdf-first9-maintext-v1"
CORE_KEYS = (
    "text_integrity_readability",
    "document_structural_integrity",
    "nontext_asset_integrity",
    "overall_data_usability",
)
TEMPLATE_SLOTS = (
    "{{PRIMARY_LATEX}}",
    "{{PAGE_COUNT}}",
)
PREPARATION_LIMITATION = (
    "The packet asserts that source-to-PDF binding and the source-to-window page mapping were verified during preparation. "
    "This assembler checks that both assertions are true but does not independently verify either binding."
)
MAX_REASON_CHARS = 500
MAX_PACKET_BYTES = 100 * 1024 * 1024


class PacketError(ValueError):
    """A prepared packet is malformed or fails closed checks."""


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_assets() -> tuple[str, dict[str, Any], str, dict[str, Any]]:
    instructions = (PROMPT_DIR / "instructions.txt").read_text(encoding="utf-8")
    rubric = json.loads((PROTOCOL_DIR / "rubric.json").read_text(encoding="utf-8"))
    output_text = (PROMPT_DIR / "output-template.json").read_text(encoding="utf-8")
    output_template = json.loads(output_text)

    if rubric.get("protocol_id") != PROTOCOL_ID:
        raise PacketError("canonical rubric is for a different protocol")
    if set(re.findall(r"\{\{[A-Z_]+\}\}", instructions)) != {"{{PAGE_COUNT}}"}:
        raise PacketError("instructions.txt must contain only the {{PAGE_COUNT}} slot")
    expected_top = {"core_scores", "pdf_visual_integrity", "limitations"}
    if set(output_template) != expected_top:
        raise PacketError("output-template.json must contain exactly core_scores, pdf_visual_integrity, and limitations")
    if set(output_template["core_scores"]) != set(CORE_KEYS):
        raise PacketError("output-template.json core score keys do not match the canonical rubric")
    for key in CORE_KEYS:
        if output_template["core_scores"][key] != {"score": None, "reason": ""}:
            raise PacketError(f"output-template.json has an unsupported shape for core score {key}")
    if output_template["pdf_visual_integrity"] != {"score": None, "reason": ""} or output_template["limitations"] != []:
        raise PacketError("output-template.json has an unsupported auxiliary/limitations shape")
    return instructions, rubric, output_text.strip(), output_template


def _render_rubric(rubric: dict[str, Any]) -> str:
    """Render the canonical English definitions and score anchors verbatim."""
    lines = ["CANONICAL SHARED RATING CRITERIA"]
    dimensions = rubric["dimensions"]
    by_key = {dimension["key"]: dimension for dimension in dimensions}
    if set(by_key) != set(CORE_KEYS):
        raise PacketError("canonical rubric core dimension set changed; review assembler before using it")
    for key in CORE_KEYS:
        dimension = by_key[key]
        lines.extend(("", f"{dimension['label']} ({key})", dimension["definition"], "Anchors:"))
        for score in range(1, 6):
            lines.append(f"{score}: {dimension['scale'][str(score)]}")
        if key == "nontext_asset_integrity":
            lines.append(f"N/A rule: {dimension['na_definition']}")

    visual = rubric["auxiliary_pdf_visual_integrity"]
    lines.extend((
        "",
        f"{visual['label']} (optional auxiliary check; not a core score)",
        visual["definition"],
        "Anchors:",
    ))
    for score in range(1, 6):
        lines.append(f"{score}: {visual['scale'][str(score)]}")
    return "\n".join(lines)


def _safe_relative_path(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PacketError(f"{label} must be a non-empty relative path")
    # Reject host paths and traversal before normalizing. Page paths resolve to
    # local images; resource filenames are retained only in host-side audits.
    if "\\" in value or re.match(r"^[A-Za-z]:", value):
        raise PacketError(f"{label} must use a project-relative POSIX path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("..", "~") for part in path.parts):
        raise PacketError(f"{label} must not be absolute or traverse outside its packet/project root")
    return value


def _read_packet(packet_path: Path) -> tuple[dict[str, Any], Path, bytes]:
    packet_path = packet_path.expanduser().resolve()
    raw = packet_path.read_bytes()
    if len(raw) > MAX_PACKET_BYTES:
        raise PacketError("packet JSON exceeds the 100 MiB offline input limit")
    try:
        packet = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PacketError(f"packet is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(packet, dict):
        raise PacketError("packet must be a JSON object")
    required = {"primary_latex", "total_pdf_pages", "pages", "preparation", "host_metadata"}
    optional = {"resource_evidence", "input_limitations"}
    if not required.issubset(packet) or set(packet) - required - optional:
        missing = sorted(required - set(packet))
        extra = sorted(set(packet) - required - optional)
        raise PacketError(f"packet keys must match the prepared schema (missing={missing}, extra={extra})")
    packet.setdefault("resource_evidence", [])
    packet.setdefault("input_limitations", [])
    return packet, packet_path.parent, raw


def _validate_packet(packet: dict[str, Any]) -> tuple[int, list[int]]:
    source = packet["primary_latex"]
    if not isinstance(source, str) or not source.strip():
        raise PacketError("primary_latex must be a non-empty UTF-8 string")

    total_pages = packet["total_pdf_pages"]
    if type(total_pages) is not int or total_pages < 1:
        raise PacketError("total_pdf_pages must be a positive integer")
    page_count = min(9, total_pages)
    pages = packet["pages"]
    if not isinstance(pages, list) or len(pages) != page_count:
        raise PacketError(f"pages must contain exactly {page_count} target PDF page images")
    page_numbers: list[int] = []
    for expected_page, item in enumerate(pages, start=1):
        if not isinstance(item, dict) or set(item) != {"page", "path"}:
            raise PacketError("each pages entry must contain exactly page and path")
        if type(item["page"]) is not int or item["page"] != expected_page:
            raise PacketError("page images must be contiguous physical PDF pages beginning at page 1")
        _safe_relative_path(item["path"], f"page {expected_page} path")
        page_numbers.append(expected_page)

    preparation = packet["preparation"]
    expected_preparation = {"source_pdf_binding_verified", "source_window_mapping_verified"}
    if not isinstance(preparation, dict) or set(preparation) != expected_preparation:
        raise PacketError("preparation must contain exactly the two required source/PDF verification assertions")
    if any(preparation[key] is not True for key in expected_preparation):
        raise PacketError("source/PDF binding and source-window mapping assertions must both be true")

    if not isinstance(packet["resource_evidence"], list):
        raise PacketError("resource_evidence must be an array")
    for index, evidence in enumerate(packet["resource_evidence"]):
        if not isinstance(evidence, dict) or not {"file", "availability", "openability"}.issubset(evidence):
            raise PacketError(f"resource_evidence[{index}] requires file, availability, and openability")
        _safe_relative_path(evidence["file"], f"resource_evidence[{index}].file")
        if not isinstance(evidence["availability"], str) or evidence["availability"] not in {"present", "missing", "unknown"}:
            raise PacketError(f"resource_evidence[{index}].availability has an unsupported value")
        if not isinstance(evidence["openability"], str) or evidence["openability"] not in {"passed", "failed", "not_checked"}:
            raise PacketError(f"resource_evidence[{index}].openability has an unsupported value")

    limitations = packet["input_limitations"]
    if not isinstance(limitations, list) or any(not isinstance(item, str) or not item.strip() for item in limitations):
        raise PacketError("input_limitations must be an array of non-empty strings")
    if not isinstance(packet["host_metadata"], dict):
        raise PacketError("host_metadata must be a JSON object")
    return page_count, page_numbers


def _image_bytes(packet_dir: Path, page: dict[str, Any]) -> tuple[bytes, str]:
    relative = _safe_relative_path(page["path"], f"page {page['page']} path")
    base = packet_dir.resolve()
    path = (base / Path(*PurePosixPath(relative).parts)).resolve()
    try:
        path.relative_to(base)
    except ValueError as exc:
        raise PacketError(f"page {page['page']} image resolves outside the packet directory") from exc
    if not path.is_file():
        raise PacketError(f"page {page['page']} image file does not exist")
    data = path.read_bytes()
    if not data:
        raise PacketError(f"page {page['page']} image file is empty")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        raise PacketError(f"page {page['page']} is not a PNG, JPEG, or WebP image")
    return data, mime


def _replace_slots_once(template: str, values: dict[str, str]) -> str:
    pattern = re.compile(r"\{\{[A-Z_]+\}\}")
    return pattern.sub(lambda match: values.get(match.group(0), match.group(0)), template)


def _render_text_prefix(
    instructions: str,
    rubric: dict[str, Any],
    output_template_text: str,
    packet: dict[str, Any],
    page_count: int,
    *,
    as_template: bool,
) -> str:
    source_block = "PRIMARY LATEX SOURCE (verbatim untrusted manuscript data):\n<PRIMARY_LATEX>\n{{PRIMARY_LATEX}}\n</PRIMARY_LATEX>"
    content = "\n\n".join((
        instructions.rstrip(),
        _render_rubric(rubric),
        "OUTPUT\nReturn one JSON object only in this shape. Replace null score placeholders with permitted values. Give one concise evidence-based sentence per reason, citing a page or source location when useful. Use an empty limitations array when there are no material limitations.\n\n" + output_template_text,
        "TARGET PDF PAGE WINDOW\nInspect only physical target PDF pages 1–{{PAGE_COUNT}} included below. Any remaining pages are outside the core scope.",
        source_block,
        "Attached target PDF page images follow in physical page order.",
    ))
    values = {
        "{{PRIMARY_LATEX}}": "{{PRIMARY_LATEX}}" if as_template else packet["primary_latex"],
        "{{PAGE_COUNT}}": "{{PAGE_COUNT}}" if as_template else str(page_count),
    }
    return _replace_slots_once(content, values)


def _model_content_text(content: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for item in content:
        if item["type"] == "text":
            parts.append(item["text"])
        elif item["type"] == "image_url":
            parts.append(f"\n[IMAGE ATTACHMENT: {item['page_label']}]\n")
    return "\n\n".join(parts).rstrip() + "\n"


def build_request(packet_path: Path, output_dir: Path) -> dict[str, Any]:
    packet, packet_dir, packet_raw = _read_packet(packet_path)
    page_count, page_numbers = _validate_packet(packet)
    instructions, rubric, output_text, _ = _load_assets()
    contract = json.loads((PROTOCOL_DIR / "protocol.json").read_text(encoding="utf-8"))
    rubric_bytes = (PROTOCOL_DIR / "rubric.json").read_bytes()
    guidance_bytes = (PROTOCOL_DIR / "guidance.json").read_bytes()
    if _sha256(rubric_bytes) != contract.get("rubric_sha256") or _sha256(guidance_bytes) != contract.get("guidance_sha256"):
        raise PacketError("rubric or guidance asset hash does not match the frozen protocol contract")
    prefix = _render_text_prefix(instructions, rubric, output_text, packet, page_count, as_template=False)

    content: list[dict[str, Any]] = [{"type": "text", "text": prefix}]
    page_records: list[dict[str, Any]] = []
    for page in packet["pages"]:
        data, mime = _image_bytes(packet_dir, page)
        data_url = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
        label = f"Target PDF physical page {page['page']}"
        content.append({"type": "text", "text": label})
        content.append({"type": "image_url", "image_url": {"url": data_url}, "page_label": label})
        page_records.append({
            "page": page["page"],
            "mime_type": mime,
            "sha256": _sha256(data),
            "bytes": len(data),
        })

    # The page label is useful in the local preview but is not part of the
    # transport schema accepted by model APIs.
    transport_content = [
        {key: value for key, value in item.items() if key != "page_label"}
        for item in content
    ]
    messages = {"messages": [{"role": "user", "content": transport_content}]}
    message_bytes = _json_bytes(messages)
    prompt_text = _model_content_text(content)
    prompt_hash = _sha256(prompt_text.encode("utf-8"))
    resource_hash = _sha256(_json_bytes(packet["resource_evidence"]))
    record = {
        "record_schema": "xacl.judge-request-record.v1",
        "protocol_id": PROTOCOL_ID,
        "prompt_version": PROMPT_VERSION,
        "rubric_version": contract["rubric_version"],
        "rubric_sha256": contract["rubric_sha256"],
        "guidance_version": contract["guidance_version"],
        "guidance_sha256": contract["guidance_sha256"],
        "scope_id": SCOPE_ID,
        "total_pdf_pages": packet["total_pdf_pages"],
        "assigned_physical_pages": page_numbers,
        "source_sha256": _sha256(packet["primary_latex"].encode("utf-8")),
        "source_bytes_utf8": len(packet["primary_latex"].encode("utf-8")),
        "page_images": page_records,
        "resource_evidence": packet["resource_evidence"],
        "resource_evidence_input_sha256": resource_hash,
        "input_limitations": packet["input_limitations"],
        "preparation_assertions": packet["preparation"],
        "preparation_limitations": [PREPARATION_LIMITATION],
        "packet_sha256": _sha256(packet_raw),
        "prompt_sha256": prompt_hash,
        "request_sha256": _sha256(message_bytes),
        "host_metadata": packet["host_metadata"],
    }

    output_dir = output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs = {
        output_dir / "messages.json": json.dumps(messages, ensure_ascii=False, indent=2) + "\n",
        output_dir / "prompt.txt": prompt_text,
        output_dir / "record.json": json.dumps(record, ensure_ascii=False, indent=2) + "\n",
    }
    collisions = [path.name for path in outputs if path.exists() or path.is_symlink()]
    if collisions:
        raise PacketError(f"refusing to overwrite existing request output(s): {', '.join(collisions)}")
    written: list[Path] = []
    try:
        for path, text in outputs.items():
            with path.open("x", encoding="utf-8", newline="\n") as stream:
                written.append(path)
                stream.write(text)
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return {"messages": messages, "prompt": prompt_text, "record": record, "output_dir": output_dir}


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def render_template(output_path: Path | None = None) -> Path:
    """Write the complete English single-user prompt with only two input slots."""
    instructions, rubric, output_text, _ = _load_assets()
    example_packet = {
        "total_pdf_pages": "{{TOTAL_PDF_PAGES}}",
        "primary_latex": "{{PRIMARY_LATEX}}",
    }
    text = _render_text_prefix(instructions, rubric, output_text, example_packet, 0, as_template=True)
    found = set(re.findall(r"\{\{[A-Z_]+\}\}", text))
    if found != set(TEMPLATE_SLOTS):
        raise PacketError(f"rendered prompt template has unexpected slots: {sorted(found)}")
    destination = output_path or (PROMPT_DIR / "prompt-template.txt")
    destination = destination.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    _write_atomic(destination, text.rstrip() + "\n")
    return destination


def validate_response(response: Any) -> None:
    """Raise PacketError unless a parsed model object matches the strict output contract."""
    _, _, _, template = _load_assets()
    if not isinstance(response, dict):
        raise PacketError("response must be a JSON object")
    _validate_exact_shape(response, template, "response")
    for key in CORE_KEYS:
        score = response["core_scores"][key]["score"]
        allowed = {"uncertain"}
        if key == "nontext_asset_integrity":
            allowed.add("na")
        if not _valid_score(score, allowed):
            raise PacketError(f"core_scores.{key}.score must be 1–5 or one of {sorted(allowed)}")
        _validate_reason(response["core_scores"][key]["reason"], f"core_scores.{key}.reason")

    visual = response["pdf_visual_integrity"]
    if not _valid_score(visual["score"], {"uncertain", "not_assessed"}):
        raise PacketError("pdf_visual_integrity.score must be 1–5, uncertain, or not_assessed")
    _validate_reason(visual["reason"], "pdf_visual_integrity.reason")
    if not isinstance(response["limitations"], list):
        raise PacketError("limitations must be an array of strings")
    if any(not isinstance(item, str) or not item.strip() for item in response["limitations"]):
        raise PacketError("limitations entries must be non-empty strings")


def _valid_score(value: Any, strings: set[str]) -> bool:
    return (type(value) is int and value in (1, 2, 3, 4, 5)) or (isinstance(value, str) and value in strings)


def _validate_reason(value: Any, path: str) -> None:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > MAX_REASON_CHARS:
        raise PacketError(f"{path} must be a non-empty concise string of at most {MAX_REASON_CHARS} characters")


def _validate_exact_shape(value: Any, template: Any, path: str) -> None:
    if isinstance(template, dict):
        if not isinstance(value, dict) or set(value) != set(template):
            raise PacketError(f"{path} has missing or unexpected keys")
        for key, child in template.items():
            _validate_exact_shape(value[key], child, f"{path}.{key}")
    elif isinstance(template, list):
        if not isinstance(value, list):
            raise PacketError(f"{path} must be an array")
    elif template is None or template == "":
        # Individual values are type-checked by the score/reason validators.
        return


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packet", nargs="?", type=Path, help="prepared packet JSON")
    parser.add_argument("--out-dir", type=Path, help="directory for messages.json, prompt.txt, and record.json")
    parser.add_argument("--render-template", action="store_true", help="render the complete prompt-template.txt")
    parser.add_argument("--template-output", type=Path, help="optional prompt-template destination")
    args = parser.parse_args(argv)
    try:
        if args.render_template:
            path = render_template(args.template_output)
            print(f"Wrote complete {PROMPT_VERSION} prompt template with two paper-input slots: {path}")
            return 0
        if args.packet is None or args.out_dir is None:
            parser.error("packet and --out-dir are required unless --render-template is used")
        built = build_request(args.packet, args.out_dir)
        record = built["record"]
        print(
            f"Assembled one user message with {len(record['assigned_physical_pages'])} target page images; "
            f"request SHA-256 {record['request_sha256']}"
        )
        return 0
    except (OSError, PacketError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"judge request error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
