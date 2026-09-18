import importlib.util
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data/body_profiles.json"

spec = importlib.util.spec_from_file_location(
    "build_body_profile_catalog",
    ROOT / "scripts/build_body_profile_catalog.py",
)
builder = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = builder
spec.loader.exec_module(builder)


class BodyProfileCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    def test_catalog_has_expected_verified_size(self):
        self.assertEqual(self.catalog["_meta"]["characterCount"], 5558)
        self.assertEqual(len(self.catalog["byInternalCode"]), 5558)

    def test_all_supported_profile_definitions_exist(self):
        self.assertEqual(set(self.catalog["profiles"]), {str(i) for i in range(18)})

    def test_internal_codes_and_profiles_are_valid(self):
        for code, row in self.catalog["byInternalCode"].items():
            self.assertRegex(code, r"^c\d{8}$")
            self.assertIn(row["profile"], range(18))
            self.assertIsInstance(row["meshProfile"], int)

    def test_known_raimon_reference_profiles(self):
        rows = self.catalog["byInternalCode"]
        self.assertEqual(rows["c01000010"]["profile"], 0)  # Mark Evans
        self.assertEqual(rows["c01000100"]["profile"], 0)  # Axel Blaze
        self.assertEqual(rows["c01000030"]["profile"], 6)  # Jack Wallside
        self.assertEqual(rows["c01000050"]["profile"], 2)  # Tod Ironside

    def test_generator_rejects_conflicting_profiles(self):
        source = {
            "source": "fixture",
            "models": {
                "a": {
                    "model_path": "_face/01_IE1/c01000010/c01000010.g4md",
                    "body_profile": 0,
                    "body_mesh_profile": 0,
                },
                "b": {
                    "model_path": "_face/01_IE1/c01000010/c01000010_alt.g4md",
                    "body_profile": 1,
                    "body_mesh_profile": 1,
                },
            },
        }
        with self.assertRaisesRegex(ValueError, "Conflicting body profiles"):
            builder.build_catalog(source)


if __name__ == "__main__":
    unittest.main()
