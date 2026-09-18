import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "inspect_vr_asset_bundle",
    ROOT / "scripts/inspect_vr_asset_bundle.py",
)
bundle = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = bundle
spec.loader.exec_module(bundle)


class InspectVrAssetBundleTests(unittest.TestCase):
    def test_detects_level5_magics_and_g4mg_extension(self):
        self.assertEqual(bundle.detect_format("x.g4md", b"G4MD" + b"\0" * 8)[0], "g4md")
        self.assertEqual(bundle.detect_format("x.g4tx", b"G4TX" + b"\0" * 8)[0], "g4tx")
        self.assertEqual(bundle.detect_format("x.g4sk", b"G4SK" + b"\0" * 8)[0], "g4sk")
        self.assertEqual(bundle.detect_format("x.g4pkm", b"G4PK" + b"\0" * 8)[0], "g4pkm")
        fmt, evidence = bundle.detect_format("x.g4mg", b"\x01\x02\x03\x04")
        self.assertEqual(fmt, "g4mg")
        self.assertIn("no magic", evidence)

    def test_inventory_zip_reports_sizes_hashes_and_embedded_references(self):
        with tempfile.TemporaryDirectory() as td:
            archive = Path(td) / "Uniform.zip"
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(
                    "sample/uniform.g4pkm",
                    b"G4PK" + b"\0" * 20 + b"G4MD" + b"\0" * 8
                    + b"_uniform/u000101/u000101.g4md\0",
                )
                zf.writestr("sample/mesh.g4mg", b"\x01\x02\x03\x04")

            report = bundle.inspect_bundle(archive)
            self.assertEqual(report["archive"]["kind"], "zip")
            self.assertEqual(report["counts"]["files"], 2)
            by_name = {row["path"]: row for row in report["files"]}
            packed = by_name["sample/uniform.g4pkm"]
            self.assertEqual(packed["format"], "g4pkm")
            self.assertTrue(packed["sha256"])
            self.assertIn(
                "_uniform/u000101/u000101.g4md",
                packed["embeddedReferences"],
            )
            self.assertEqual(by_name["sample/mesh.g4mg"]["format"], "g4mg")

    def test_requirement_matching_is_exact_suffix_only(self):
        manifest = {
            "id": "test",
            "requirements": [
                {
                    "role": "uniform",
                    "required": True,
                    "acceptedPathSuffixes": ["_uniform/u000101/u000101.g4md"],
                }
            ],
        }
        files = [
            bundle.inspect_bytes("dump/_uniform/u000101/u000101.g4md", b"G4MDxxxx"),
            bundle.inspect_bytes("dump/_uniform/u999999/u000101.g4md", b"G4MDxxxx"),
        ]
        check = bundle.match_requirements(files, manifest)
        self.assertTrue(check["allRequiredPresent"])
        self.assertEqual(len(check["matches"][0]["found"]), 1)
        self.assertEqual(
            check["matches"][0]["found"][0]["path"],
            "dump/_uniform/u000101/u000101.g4md",
        )

    def test_default_mark_manifest_preserves_exact_anchor_values(self):
        manifest_path = ROOT / "data/mark_raimon_asset_requirements.json"
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(payload["character"]["internalCode"], "c01000010")
        self.assertEqual(payload["character"]["bodyId"], 613579)
        self.assertEqual(payload["character"]["bodyTypeIdx"], 0)
        self.assertEqual(payload["character"]["skeleton"], "c000101")
        self.assertEqual(payload["uniform"]["kitNameIdHex"], "0x252CE113")
        self.assertEqual(payload["uniform"]["fielderModelCrcHex"], "0x9D2BBD10")
        self.assertEqual(payload["uniform"]["logicalCode"], "u010101_10")
        self.assertEqual(payload["uniform"]["meshCode"], "u000101")


if __name__ == "__main__":
    unittest.main()
