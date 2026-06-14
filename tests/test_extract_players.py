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

    def test_writes_browser_ready_javascript(self):
        players = extract_players.extract_records(self.markup, extract_players.SOURCE_URL)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "players.js"
            extract_players.write_players(players, output, extract_players.SOURCE_URL)
            text = output.read_text(encoding="utf-8")
        self.assertIn("globalThis.INAZUMA_PLAYERS = [", text)
        self.assertIn('"name": "Mark Evans"', text)

    def test_zero_players_does_not_replace_output(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            html = directory / "empty.html"
            output = directory / "players.js"
            html.write_text("<html><body>No matching players</body></html>", encoding="utf-8")
            output.write_text("existing sample", encoding="utf-8")
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
            self.assertEqual(output.read_text(encoding="utf-8"), "existing sample")


if __name__ == "__main__":
    unittest.main()
