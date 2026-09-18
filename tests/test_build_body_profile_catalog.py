import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "build_body_profile_catalog",
    ROOT / "scripts/build_body_profile_catalog.py",
)
body_catalog = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = body_catalog
spec.loader.exec_module(body_catalog)


class BuildBodyProfileCatalogTests(unittest.TestCase):
    def test_builds_character_to_body_catalog_without_guessing(self):
        payload = {
            "version": 2,
            "source": "chara_model_test.cfg.bin.xml",
            "models": {
                "_face/01_IE1/c01000010/c01000010.g4md": {
                    "body_id": 613579,
                    "body_path": "_common/c000101/c000101.objbin",
                    "g4sk_path": "c000101/c000101.g4sk",
                    "g4sk_stem": "c000101",
                    "body_profile": 0,
                    "body_mesh_profile": 0,
                },
                "_face/01_IE1/c01000030/c01000030.g4md": {
                    "body_id": 1382133758,
                    "body_path": "_common/c000401/c000401.objbin",
                    "g4sk_path": "c000401/c000401.g4sk",
                    "g4sk_stem": "c000401",
                    "body_profile": 6,
                    "body_mesh_profile": 6,
                },
            },
        }

        catalog = body_catalog.build_catalog(payload)

        self.assertEqual(catalog["counts"], {"characters": 2, "bodies": 2})
        self.assertEqual(catalog["characters"]["c01000010"], 613579)
        self.assertEqual(catalog["bodies"]["613579"]["bodyProfile"], 0)
        self.assertEqual(catalog["bodies"]["1382133758"]["bodyProfile"], 6)

    def test_preserves_body_profile_and_mesh_profile_separately(self):
        payload = {
            "models": {
                "_face/01_IE1/c01002110/c01002110.g4md": {
                    "body_id": -1707720557,
                    "body_path": "_common/c000201/c000201.objbin",
                    "g4sk_path": "c000201/c000201.g4sk",
                    "g4sk_stem": "c000201",
                    "body_profile": 10,
                    "body_mesh_profile": 2,
                }
            }
        }

        catalog = body_catalog.build_catalog(payload)
        body = catalog["bodies"]["-1707720557"]
        self.assertEqual(body["bodyProfile"], 10)
        self.assertEqual(body["bodyMeshProfile"], 2)


if __name__ == "__main__":
    unittest.main()
