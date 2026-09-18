import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts/build_player_body_profiles.py"

spec = importlib.util.spec_from_file_location("build_player_body_profiles", MODULE_PATH)
body_profiles = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = body_profiles
spec.loader.exec_module(body_profiles)


MODEL_Q_MARK = "hN2cl56NnpyLmo2glpvdxaTdnM_Oz8_Pz87P3aKC"
PARAM_Q_MARK = (
    "hN2ZlpOLmo2gnJeejZ6glpugjIuN3cWk3ZzPzs_Pz8_Oz92igg%3D%3D"
)


class BuildPlayerBodyProfilesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = body_profiles.load_body_catalog(
            ROOT / "data/victory_road_body_profiles.json"
        )

    def test_reads_exact_source_url_from_players_js(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "players.js"
            path.write_text(
                "// Source: https://zukan.inazuma.jp/en/chara_list/?q=abc&per_page=50\n"
                "globalThis.INAZUMA_PLAYERS = [];\n",
                encoding="utf-8",
            )
            self.assertEqual(
                body_profiles.source_url_from_players_js(path),
                "https://zukan.inazuma.jp/en/chara_list/?q=abc&per_page=50",
            )

    def test_decodes_both_live_zukan_q_shapes(self):
        self.assertEqual(
            body_profiles.decode_zukan_q(MODEL_Q_MARK),
            {"character_id": ["c01000010"]},
        )
        self.assertEqual(
            body_profiles.decode_zukan_q(PARAM_Q_MARK),
            {"filter_chara_id_str": ["c01000010"]},
        )

    def test_extracts_number_and_internal_code_from_same_row(self):
        markup = f"""
        <table>
          <tr><th>No.</th><th>Name</th></tr>
          <tr>
            <td>1</td>
            <td>
              <a href="/en/chara_param/?q={PARAM_Q_MARK}">Mark Evans</a>
              <a href="/en/chara_model_view/?q={MODEL_Q_MARK}">3D</a>
            </td>
          </tr>
        </table>
        """
        mapping, conflicts = body_profiles.extract_number_code_map(
            markup, "https://zukan.inazuma.jp/en/chara_list/"
        )
        self.assertEqual(mapping, {1: "c01000010"})
        self.assertEqual(conflicts, {})

    def test_does_not_guess_from_name_when_q_is_missing(self):
        markup = """
        <table>
          <tr><th>No.</th><th>Name</th></tr>
          <tr><td>1</td><td>Mark Evans</td></tr>
        </table>
        """
        mapping, conflicts = body_profiles.extract_number_code_map(
            markup, "https://zukan.inazuma.jp/en/chara_list/"
        )
        self.assertEqual(mapping, {})
        self.assertEqual(conflicts, {})

    def test_rejects_conflicting_codes_in_one_row(self):
        other_q = body_profiles.base64.urlsafe_b64encode(
            bytes((~byte) & 0xFF for byte in b'{"character_id":["c01000100"]}')
        ).decode("ascii").rstrip("=")
        markup = f"""
        <table>
          <tr><th>No.</th><th>Name</th></tr>
          <tr>
            <td>1</td>
            <td>
              <a href="/chara_model_view/?q={MODEL_Q_MARK}">A</a>
              <a href="/chara_model_view/?q={other_q}">B</a>
            </td>
          </tr>
        </table>
        """
        mapping, conflicts = body_profiles.extract_number_code_map(
            markup, "https://zukan.inazuma.jp/en/chara_list/"
        )
        self.assertEqual(mapping, {})
        self.assertEqual(
            conflicts,
            {1: ["c01000010", "c01000100"]},
        )

    def test_known_victory_road_body_anchors(self):
        players = [
            {"id": 1, "name": "Mark Evans"},
            {"id": 2, "name": "Axel Blaze"},
            {"id": 5, "name": "Jack Wallside"},
            {"id": 8, "name": "Tod Ironside"},
        ]
        codes = {
            1: "c01000010",
            2: "c01000100",
            5: "c01000030",
            8: "c01000050",
        }
        result, report = body_profiles.build_player_map(
            players, codes, self.catalog
        )

        self.assertEqual(result["1"]["bodyTypeIdx"], 0)
        self.assertEqual(result["1"]["bodyModel"], "base_normal_00")
        self.assertEqual(result["2"]["bodyTypeIdx"], 0)
        self.assertEqual(result["5"]["bodyTypeIdx"], 6)
        self.assertEqual(result["5"]["bodyModel"], "base_bigman_01")
        self.assertEqual(result["8"]["bodyTypeIdx"], 2)
        self.assertEqual(result["8"]["bodyModel"], "base_normal_02")
        self.assertEqual(report["totals"]["bodyTypesResolved"], 4)
        self.assertEqual(report["totals"]["manualAssignments"], 0)

    def test_special_body_is_not_declared_standard_uniform_compatible(self):
        characters = self.catalog["characters"]
        bodies = self.catalog["bodies"]
        animal_code = next(
            code
            for code, body_id in characters.items()
            if int(bodies[str(body_id)]["bodyProfile"]) == 101
        )
        result, _ = body_profiles.build_player_map(
            [{"id": 99, "name": "Animal"}],
            {99: animal_code},
            self.catalog,
        )
        self.assertEqual(result["99"]["bodyKind"], "animal")
        self.assertFalse(result["99"]["supportsStandardUniform"])

    def test_atomic_writer_leaves_valid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "out.json"
            body_profiles.write_json_atomic(path, {"1": {"bodyTypeIdx": 6}})
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")),
                {"1": {"bodyTypeIdx": 6}},
            )
            self.assertFalse(path.with_suffix(".json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
