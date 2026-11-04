#!/usr/bin/env python3
"""Focused offline tests for the single-user judge request assembler."""
from __future__ import annotations

import base64
import copy
import contextlib
import hashlib
import io
import json
import re
import tempfile
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import build_judge_request as judge


PROTOCOL_DIR = ROOT / "site/protocols/latex-data-usability-v1"
PROMPT_DIR = ROOT / "docs/latex-data-usability-v1/judge-user-v2"
RUBRIC = json.loads((PROTOCOL_DIR / "rubric.json").read_text(encoding="utf-8"))
OUTPUT_TEMPLATE = json.loads((PROMPT_DIR / "output-template.json").read_text(encoding="utf-8"))
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)
JPEG = b"\xff\xd8\xff\xdb\x00\x43" + bytes(range(0x43))
WEBP = b"RIFF\x0e\x00\x00\x00WEBPVP8 " + bytes(range(6))
SCORE_KEYS = [
    "text_integrity_readability",
    "document_structural_integrity",
    "nontext_asset_integrity",
    "overall_data_usability",
]


def packet_for(directory: Path, *, total_pages: int = 2, source: str | None = None) -> dict:
    count = min(9, total_pages)
    pages = []
    for number in range(1, count + 1):
        name = f"page{number:02}.png"
        (directory / name).write_bytes(PNG)
        pages.append({"page": number, "path": name})
    return {
        "primary_latex": source or r"\documentclass{article}\begin{document}A short manuscript.\end{document}",
        "total_pdf_pages": total_pages,
        "pages": pages,
        "resource_evidence": [{
            "file": "figures/plot.png",
            "availability": "present",
            "openability": "passed",
            "sha256": "RESOURCE_HASH_SENTINEL",
            "bytes": 431,
            "runtime_path": "/private/tmp/RUNTIME_PATH_SENTINEL/plot.png",
            "protocol_id": "RESOURCE_PROTOCOL_SENTINEL",
            "binding_sha256": "BINDING_HASH_SENTINEL",
        }],
        "input_limitations": ["MATERIAL_LIMITATION_SENTINEL: the inventory is project-wide."],
        "preparation": {
            "source_pdf_binding_verified": True,
            "source_window_mapping_verified": True,
        },
        "host_metadata": {
            "model": "HOST_ONLY_MODEL_SENTINEL",
            "provider": "HOST_ONLY_PROVIDER_SENTINEL",
            "source_runtime_path": "/private/tmp/HOST_ONLY_PATH_SENTINEL/source.tar.gz",
            "protocol_id": "HOST_ONLY_PROTOCOL_SENTINEL",
            "binding_sha256": "HOST_ONLY_BINDING_HASH_SENTINEL",
        },
    }


def write_packet(directory: Path, packet: dict, name: str = "packet.json") -> Path:
    path = directory / name
    path.write_text(json.dumps(packet, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def valid_response() -> dict:
    return {
        "core_scores": {
            "text_integrity_readability": {"score": 4, "reason": "The inspected text is intact."},
            "document_structural_integrity": {"score": "uncertain", "reason": "A source boundary is not visible."},
            "nontext_asset_integrity": {"score": "na", "reason": "No relevant non-text objects occur in scope."},
            "overall_data_usability": {"score": 5, "reason": "The inspected data is usable within scope."},
        },
        "pdf_visual_integrity": {"score": "not_assessed", "reason": "No page image was inspected."},
        "limitations": ["The inventory is not page-specific."],
    }


class JudgeRequestTests(unittest.TestCase):
    def test_complete_prompt_is_canonical_single_user_text_with_four_slots(self):
        with tempfile.TemporaryDirectory() as temp:
            first = Path(temp) / "first.txt"
            second = Path(temp) / "second.txt"
            judge.render_template(first)
            judge.render_template(second)
            text = first.read_text(encoding="utf-8")
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(
                set(re.findall(r"\{\{[A-Z_]+\}\}", text)),
                set(judge.TEMPLATE_SLOTS),
            )
            for dimension in [*RUBRIC["dimensions"], RUBRIC["auxiliary_pdf_visual_integrity"]]:
                self.assertIn(dimension["label"], text)
                self.assertIn(dimension["definition"], text)
                for anchor in dimension["scale"].values():
                    self.assertIn(anchor, text)
            self.assertIn(RUBRIC["dimensions"][2]["na_definition"], text)
            self.assertIn('"core_scores"', text)
            self.assertIn('"pdf_visual_integrity"', text)
            self.assertIn('"limitations"', text)
            self.assertNotIn("reviewed_declared_scope", text)
            self.assertNotIn('"issue_codes"', text)
            self.assertNotIn(RUBRIC["auxiliary_pdf_visual_integrity"]["source_only_rule"], text)
            for host_key in ("protocol_id", "rubric_sha256", "manifest_sha256", "source_pdf_binding_verified"):
                self.assertNotIn(host_key, text)
            for separate_file in ("instructions.txt", "rubric.json", "output-template.json", "judge-system.txt"):
                self.assertNotIn(separate_file, text)

            marker = text.index("Return one JSON object only")
            brace = text.index("{", marker)
            output_schema, _ = json.JSONDecoder().raw_decode(text[brace:])
            self.assertEqual(output_schema, OUTPUT_TEMPLATE)

    def test_packet_builds_one_user_message_with_ordered_real_image_bytes_and_host_metadata_isolated(self):
        source = (
            r"\documentclass{article}"
            "\n% literal slots: {{PRIMARY_LATEX}} {{RESOURCE_EVIDENCE}} {{INPUT_LIMITATIONS}} {{PAGE_COUNT}}"
            "\n\\immediate\\write18{touch SHOULD_NEVER_EXIST}"
            "\n\\begin{document}Manuscript text.\\end{document}"
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packet = packet_for(root, source=source)
            input_path = write_packet(root, packet)
            before = {
                "packet": hashlib.sha256(input_path.read_bytes()).hexdigest(),
                **{entry["path"]: hashlib.sha256((root / entry["path"]).read_bytes()).hexdigest() for entry in packet["pages"]},
            }
            result = judge.build_request(input_path, root / "request")
            messages = json.loads((root / "request/messages.json").read_text(encoding="utf-8"))
            record = json.loads((root / "request/record.json").read_text(encoding="utf-8"))
            content = messages["messages"][0]["content"]
            self.assertEqual(set(messages), {"messages"})
            self.assertEqual(len(messages["messages"]), 1)
            self.assertEqual(messages["messages"][0]["role"], "user")
            self.assertEqual(content[0]["type"], "text")
            text = content[0]["text"]
            self.assertIn(source, text)
            for slot in judge.TEMPLATE_SLOTS[:3]:
                if slot != "{{PAGE_COUNT}}":
                    self.assertIn(slot, text)
            self.assertIn("MATERIAL_LIMITATION_SENTINEL: the inventory is project-wide.", text)
            self.assertNotIn(judge.PREPARATION_LIMITATION, text)
            self.assertIn("physical target PDF pages 1–2", text)
            self.assertIn("Attached target PDF page images follow in physical page order.", text)
            self.assertNotIn("source_pdf_binding_verified", text)
            self.assertNotIn("source_window_mapping_verified", text)
            for sentinel in (
                "HOST_ONLY_MODEL_SENTINEL", "HOST_ONLY_PROVIDER_SENTINEL", "HOST_ONLY_PATH_SENTINEL",
                "HOST_ONLY_PROTOCOL_SENTINEL", "HOST_ONLY_BINDING_HASH_SENTINEL", "RESOURCE_HASH_SENTINEL",
                "RUNTIME_PATH_SENTINEL", "RESOURCE_PROTOCOL_SENTINEL", "BINDING_HASH_SENTINEL",
            ):
                self.assertNotIn(sentinel, text)
            projected = json.loads(text.split("RESOURCE EVIDENCE", 1)[1].split("INPUT LIMITATIONS", 1)[0].split("only):\n", 1)[1])
            self.assertEqual(projected, [{"file": "figures/plot.png", "availability": "present", "openability": "passed"}])

            self.assertEqual([item["text"] for item in content[1::2] if item["type"] == "text"], [
                "Target PDF physical page 1", "Target PDF physical page 2",
            ])
            image_items = [content[index] for index in (2, 4)]
            for image, page in zip(image_items, packet["pages"], strict=True):
                self.assertEqual(image["type"], "image_url")
                self.assertEqual(set(image), {"type", "image_url"})
                data_url = image["image_url"]["url"]
                self.assertTrue(data_url.startswith("data:image/png;base64,"))
                decoded = base64.b64decode(data_url.split(",", 1)[1])
                self.assertEqual(decoded, (root / page["path"]).read_bytes())

            prompt = (root / "request/prompt.txt").read_text(encoding="utf-8")
            self.assertIn(source, prompt)
            self.assertIn("[IMAGE ATTACHMENT: Target PDF physical page 1]", prompt)
            self.assertIn("[IMAGE ATTACHMENT: Target PDF physical page 2]", prompt)
            self.assertNotIn("HOST_ONLY_MODEL_SENTINEL", prompt)
            self.assertEqual(record["host_metadata"], packet["host_metadata"])
            self.assertEqual(record["preparation_assertions"], packet["preparation"])
            self.assertEqual(record["preparation_limitations"], [judge.PREPARATION_LIMITATION])
            self.assertEqual(record["input_limitations"], packet["input_limitations"])
            self.assertEqual(record["assigned_physical_pages"], [1, 2])
            self.assertEqual(record["source_sha256"], hashlib.sha256(source.encode()).hexdigest())
            self.assertEqual(record["request_sha256"], hashlib.sha256(judge._json_bytes(messages)).hexdigest())
            self.assertFalse((root / "SHOULD_NEVER_EXIST").exists())
            after = {
                "packet": hashlib.sha256(input_path.read_bytes()).hexdigest(),
                **{entry["path"]: hashlib.sha256((root / entry["path"]).read_bytes()).hexdigest() for entry in packet["pages"]},
            }
            self.assertEqual(before, after)
            self.assertEqual(result["messages"], messages)

    def test_page_count_caps_at_nine_and_detects_actual_png_jpeg_webp_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packet = packet_for(root, total_pages=11)
            input_path = write_packet(root, packet)
            result = judge.build_request(input_path, root / "request")
            content = result["messages"]["messages"][0]["content"]
            self.assertEqual(len([item for item in content if item["type"] == "image_url"]), 9)
            self.assertEqual(result["record"]["assigned_physical_pages"], list(range(1, 10)))

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            bytes_by_type = {"png": PNG, "jpeg": JPEG, "webp": WEBP}
            packet = {
                "primary_latex": "\textbf{test}",
                "total_pdf_pages": 3,
                "pages": [],
                "resource_evidence": [],
                "input_limitations": [],
                "preparation": {"source_pdf_binding_verified": True, "source_window_mapping_verified": True},
                "host_metadata": {},
            }
            for index, (ext, data) in enumerate(bytes_by_type.items(), start=1):
                name = f"page{index}.{ext}"
                (root / name).write_bytes(data)
                packet["pages"].append({"page": index, "path": name})
            input_path = write_packet(root, packet)
            result = judge.build_request(input_path, root / "request")
            images = [item for item in result["messages"]["messages"][0]["content"] if item["type"] == "image_url"]
            self.assertEqual([item["image_url"]["url"].split(";", 1)[0] for item in images], [
                "data:image/png", "data:image/jpeg", "data:image/webp",
            ])
            self.assertEqual([row["mime_type"] for row in result["record"]["page_images"]], [
                "image/png", "image/jpeg", "image/webp",
            ])

    def test_cli_build_writes_artifacts_and_emits_only_small_stats(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packet_path = write_packet(root, packet_for(root))
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                code = judge.main([str(packet_path), "--out-dir", str(root / "cli-request")])
            self.assertEqual(code, 0)
            message = stdout.getvalue()
            self.assertIn("one user message", message)
            self.assertIn("request SHA-256", message)
            self.assertNotIn("HOST_ONLY_MODEL_SENTINEL", message)
            self.assertNotIn("Manuscript", message)
            for name in ("messages.json", "prompt.txt", "record.json"):
                self.assertTrue((root / "cli-request" / name).is_file())

    def test_packet_failures_are_closed_and_existing_outputs_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            packet = packet_for(root)
            variants = []
            missing_page = copy.deepcopy(packet)
            missing_page["pages"].pop()
            variants.append(missing_page)
            noncontiguous = copy.deepcopy(packet)
            noncontiguous["pages"][1]["page"] = 3
            variants.append(noncontiguous)
            false_binding = copy.deepcopy(packet)
            false_binding["preparation"]["source_pdf_binding_verified"] = False
            variants.append(false_binding)
            false_mapping = copy.deepcopy(packet)
            false_mapping["preparation"]["source_window_mapping_verified"] = False
            variants.append(false_mapping)
            traversal = copy.deepcopy(packet)
            traversal["pages"][0]["path"] = "../page01.png"
            variants.append(traversal)
            resource_path = copy.deepcopy(packet)
            resource_path["resource_evidence"][0]["file"] = "/tmp/private.png"
            variants.append(resource_path)
            for index, invalid in enumerate(variants):
                input_path = write_packet(root, invalid, name=f"invalid{index}.json")
                with self.subTest(index=index), self.assertRaises(judge.PacketError):
                    judge.build_request(input_path, root / f"request{index}")
                self.assertFalse((root / f"request{index}/messages.json").exists())

            unsupported = copy.deepcopy(packet)
            unsupported["pages"][0]["path"] = "not-image.bin"
            (root / "not-image.bin").write_bytes(b"plain text")
            with self.assertRaises(judge.PacketError):
                judge.build_request(write_packet(root, unsupported, "unsupported.json"), root / "unsupported")

            valid_path = write_packet(root, packet, name="valid.json")
            output = root / "collision"
            output.mkdir()
            sentinel = output / "record.json"
            sentinel.write_text("preserve me", encoding="utf-8")
            with self.assertRaisesRegex(judge.PacketError, "refusing to overwrite"):
                judge.build_request(valid_path, output)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserve me")
            self.assertFalse((output / "messages.json").exists())

    def test_response_validator_accepts_only_frozen_scores_and_short_reasons(self):
        valid = valid_response()
        judge.validate_response(valid)
        for visual_score in (1, 3, 5, "uncertain", "not_assessed"):
            candidate = copy.deepcopy(valid)
            candidate["pdf_visual_integrity"]["score"] = visual_score
            judge.validate_response(candidate)

        invalid = []
        candidate = copy.deepcopy(valid)
        candidate["core_scores"]["text_integrity_readability"]["score"] = True
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["core_scores"]["text_integrity_readability"]["score"] = "na"
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["core_scores"]["nontext_asset_integrity"]["score"] = "not_assessed"
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["core_scores"]["overall_data_usability"]["score"] = None
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["pdf_visual_integrity"]["score"] = True
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["pdf_visual_integrity"]["score"] = "na"
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["core_scores"]["text_integrity_readability"]["reason"] = "   "
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["core_scores"]["text_integrity_readability"]["reason"] = "x" * (judge.MAX_REASON_CHARS + 1)
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["core_scores"]["text_integrity_readability"]["host_note"] = "extra"
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["limitations"] = ["", 3]
        invalid.append(candidate)
        candidate = copy.deepcopy(valid)
        candidate["protocol_id"] = "unexpected"
        invalid.append(candidate)
        for candidate in invalid:
            with self.subTest(candidate=candidate), self.assertRaises(judge.PacketError):
                judge.validate_response(candidate)


if __name__ == "__main__":
    unittest.main()
