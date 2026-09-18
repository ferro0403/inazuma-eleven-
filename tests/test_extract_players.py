import importlib.util
import io
import tempfile
import unittest
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("extract_players", ROOT / "scripts/extract_players.py")
extract_players = importlib.util.module_from_spec(spec)
assert spec.loader
sys.modules[spec.name] = extract_players
spec.loader.exec_module(extract_players)


class ExtractPlayersTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.markup = (ROOT / "fixtures/chara_list_sample.html").read_text(encoding="utf-8")

    def test_extracts_all_requested_fields_and_portraits(self):
        players = extract_players.extract_records(self.markup, extract_players.SOURCE_URL)
        self.assertEqual(len(players), 2)
        self.assertEqual(players[0], {
            "id": 1,
            "name": "Mark Evans",
            "nickname": "Evans",
            "game": "Inazuma Eleven",
            "gender": "Male",
            "element": "Mountain",
            "position": "GK",
            "characterRole": "Player",
            "ageGroup": "Middle School",
            "schoolYear": "Grade 8",
            "teams": ["Raimon", "Inazuma National"],
            "description": "Has more passion for football than anyone else.",
            "imageUrl": "https://zukan.inazuma.jp/portraits/1.png",
        })
        self.assertEqual(players[1]["schoolYear"], "")
        self.assertEqual(players[1]["imageUrl"], "https://cdn.example/36.webp")

    def test_finds_last_pagination_page(self):
        urls = extract_players.pagination_urls(self.markup, extract_players.SOURCE_URL)
        self.assertTrue(urls[-1].endswith("?page=110"))
        self.assertEqual(extract_players.page_number(urls[-1]), 110)

    def test_page_url_preserves_long_filtered_query(self):
        start_url = (
            "https://zukan.inazuma.jp/en/chara_list/"
            "?team%5B%5D=Raimon&team%5B%5D=Inazuma+National"
            "&position=GK&keyword=Mark+Evans&empty=&page=7#results"
        )
        page = extract_players.page_url(start_url, 12)
        self.assertEqual(
            page,
            "https://zukan.inazuma.jp/en/chara_list/"
            "?team%5B%5D=Raimon&team%5B%5D=Inazuma+National"
            "&position=GK&keyword=Mark+Evans&empty=&page=12#results",
        )

    def test_portrait_is_selected_from_the_same_player_row(self):
        markup = self.markup.replace(
            '<img class="chara-portrait" src="/portraits/1.png" alt="Mark Evans">',
            '<img src="/icons/mountain.png" class="element-icon"><img class="chara-portrait" src="/portraits/1.png" alt="Mark Evans">',
        )
        players = extract_players.extract_records(markup, extract_players.SOURCE_URL)
        self.assertEqual(players[0]["imageUrl"], "https://zukan.inazuma.jp/portraits/1.png")
        self.assertEqual(players[1]["imageUrl"], "https://cdn.example/36.webp")


    def test_decodes_real_zukan_character_queries(self):
        self.assertEqual(
            extract_players.decode_zukan_query(
                "hN2cl56NnpyLmo2glpvdxaTdnM_Oz8_Pzs_P3aKC"
            ),
            "c01000100",
        )
        self.assertEqual(
            extract_players.decode_zukan_query(
                "hN2ZlpOLmo2gnJeejZ6glpugjIuN3cWk3ZzPzs_Pz8_Mz92igg"
            ),
            "c01000030",
        )
        self.assertEqual(extract_players.decode_zukan_query("not-a-zukan-query"), "")

    def test_extracts_internal_code_from_player_name_link(self):
        markup = self.markup.replace(
            "<a>Mark Evans</a>",
            '<a href="/en/chara_param/?q=hN2ZlpOLmo2gnJeejZ6glpugjIuN3cWk3ZzPzs_Pz87Pz92igg">Mark Evans</a>',
        )
        players = extract_players.extract_records(markup, extract_players.SOURCE_URL)
        self.assertEqual(players[0]["internalCode"], "c01000100")

    def test_uniform_mesh_profile_uses_body_then_mesh_fallback(self):
        self.assertEqual(extract_players.preferred_uniform_mesh_profile(0, 0), 0)
        self.assertEqual(extract_players.preferred_uniform_mesh_profile(6, 6), 6)
        self.assertEqual(extract_players.preferred_uniform_mesh_profile(10, 2), 2)
        self.assertEqual(extract_players.preferred_uniform_mesh_profile(17, 5), 5)
        self.assertEqual(extract_players.preferred_uniform_mesh_profile(2, 255), 2)
        self.assertEqual(extract_players.preferred_uniform_mesh_profile(101, 101), 0)

    def test_body_profiles_are_resolved_from_authoritative_lookup(self):
        lookup = {
            "models": {
                "axel": {
                    "model_path": "_face/01_IE1/c01000100/c01000100.g4md",
                    "body_profile": 0,
                    "body_mesh_profile": 0,
                    "g4sk_stem": "c000101",
                },
                "jack": {
                    "model_path": "_face/01_IE1/c01000030/c01000030.g4md",
                    "body_profile": 6,
                    "body_mesh_profile": 6,
                    "g4sk_stem": "c000401",
                },
                "tod": {
                    "model_path": "_face/01_IE1/c01000050/c01000050.g4md",
                    "body_profile": 2,
                    "body_mesh_profile": 2,
                    "g4sk_stem": "c000201",
                },
                # Shared skeleton/body assets are deliberately ignored even
                # though their names also start with "c".
                "shared-base-a": {
                    "model_path": "_common/c000101/c000101.g4md",
                    "body_profile": 0,
                    "body_mesh_profile": 0,
                    "g4sk_stem": "c000101",
                },
                "shared-base-b": {
                    "model_path": "_face/20_EDIT/_base/c000101.g4md",
                    "body_profile": 1,
                    "body_mesh_profile": 1,
                    "g4sk_stem": "c000101",
                },
            }
        }
        index = extract_players.build_body_profile_index(lookup)
        self.assertNotIn("c000101", index)
        players = [
            {"id": 2, "name": "Axel Blaze", "internalCode": "c01000100"},
            {"id": 5, "name": "Jack Wallside", "internalCode": "c01000030"},
            {"id": 8, "name": "Tod Ironside", "internalCode": "c01000050"},
        ]

        resolved, unresolved = extract_players.enrich_body_profiles(players, index)

        self.assertEqual(resolved, 3)
        self.assertEqual(unresolved, [])
        self.assertEqual(players[0]["bodyProfile"], 0)
        self.assertEqual(players[0]["bodyModel"], "base_normal_00")
        self.assertEqual(players[0]["uniformMeshProfile"], 0)
        self.assertEqual(players[1]["bodyProfile"], 6)
        self.assertEqual(players[1]["bodyModel"], "base_bigman_01")
        self.assertEqual(players[1]["uniformMeshProfile"], 6)
        self.assertEqual(players[2]["bodyProfile"], 2)
        self.assertEqual(players[2]["bodyModel"], "base_normal_02")
        self.assertEqual(players[2]["uniformMeshProfile"], 2)
        self.assertEqual(players[2]["bodySkeleton"], "c000201")

    def test_writes_browser_ready_javascript(self):
        players = extract_players.extract_records(self.markup, extract_players.SOURCE_URL)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "players.js"
            extract_players.write_players(players, output, extract_players.SOURCE_URL)
            text = output.read_text(encoding="utf-8")
            loaded = extract_players.load_players(output)
        self.assertIn("globalThis.INAZUMA_PLAYERS = [", text)
        self.assertIn('"name": "Mark Evans"', text)
        self.assertEqual(loaded, players)

    def test_merge_preserves_players_and_updates_only_with_information(self):
        existing = [
            {
                "id": 1,
                "name": "Old Name",
                "nickname": "Existing nickname",
                "game": "Inazuma Eleven",
                "gender": "Male",
                "element": "Mountain",
                "position": "GK",
                "characterRole": "Player",
                "ageGroup": "Middle School",
                "schoolYear": "Second Year",
                "teams": ["Raimon"],
                "description": "Existing description",
                "imageUrl": "https://example.test/old.png",
            },
            {"id": 999, "name": "Existing Only", "teams": ["Legacy Team"]},
        ]
        extracted = [{
            "id": 1,
            "name": "Mark Evans",
            "nickname": "",
            "game": "Inazuma Eleven",
            "gender": "Male",
            "element": "Mountain",
            "position": "GK",
            "characterRole": "Player",
            "ageGroup": "Middle School",
            "schoolYear": "",
            "teams": ["Raimon", "Inazuma National"],
            "description": "New official description",
            "imageUrl": "https://zukan.inazuma.jp/portraits/1.png",
        }]

        merged, duplicates = extract_players.merge_players(existing, extracted)

        self.assertEqual(duplicates, 1)
        self.assertEqual([player["id"] for player in merged], [1, 999])
        self.assertEqual(merged[0]["name"], "Mark Evans")
        self.assertEqual(merged[0]["nickname"], "Existing nickname")
        self.assertEqual(merged[0]["schoolYear"], "Second Year")
        self.assertEqual(merged[0]["teams"], ["Raimon", "Inazuma National"])
        self.assertEqual(merged[1]["name"], "Existing Only")

    def test_repeated_extractions_continuously_grow_the_output(self):
        first = [{"id": 1, "name": "Mark Evans", "teams": ["Raimon"]}]
        second = [{"id": 2, "name": "Nathan Swift", "teams": ["Raimon"]}]
        merged, duplicates = extract_players.merge_players([], first)
        merged, second_duplicates = extract_players.merge_players(merged, second)
        self.assertEqual(duplicates + second_duplicates, 0)
        self.assertEqual([player["id"] for player in merged], [1, 2])

    def test_zero_players_does_not_replace_output(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            html = directory / "empty.html"
            output = directory / "players.js"
            html.write_text("<html><body>No matching players</body></html>", encoding="utf-8")
            output.write_text(
                'globalThis.INAZUMA_PLAYERS = [{"id": 7, "name": "Existing"}];\n',
                encoding="utf-8",
            )
            original = output.read_text(encoding="utf-8")
            argv = [
                "extract_players.py",
                "--url",
                "https://example.test/filtered?team=none",
                "--html",
                str(html),
                "--output",
                str(output),
            ]
            with patch.object(sys, "argv", argv), redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(RuntimeError, "Zero players"):
                    extract_players.main()
            self.assertEqual(output.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
