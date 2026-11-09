import sys
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import complete_inacodex as im

class CompleteInaCodexTests(unittest.TestCase):
    def test_new_team_contains_old_and_new_players_and_existing_team_is_preserved(self):
        seed = [{"id": "raimon", "name": "Raimon", "logoUrl": "official.png",
                 "aliases": ["Raimon FC"], "playerIds": [1], "notes": "hand edited"}]
        old = [{"id": 1, "teams": ["Raimon", "New Champions"]}]
        new = [{"id": 5001, "teams": ["Raimon FC", "New Champions"]}]
        teams, report = im.merge_teams(seed, old, new)
        self.assertEqual(report["teamsCreated"], 1)
        self.assertEqual(teams[0]["playerIds"], [1, 5001])
        self.assertEqual(teams[0]["logoUrl"], "official.png")
        self.assertEqual(teams[0]["notes"], "hand edited")
        self.assertEqual(teams[1]["name"], "New Champions")
        self.assertEqual(teams[1]["playerIds"], [1, 5001])
        self.assertEqual(seed[0]["playerIds"], [1])

    def test_import_is_idempotent_and_existing_team_not_rebuilt(self):
        seed = [{"id": "raimon", "name": "Raimon", "logoUrl": "",
                 "aliases": [], "playerIds": [1, 2], "notes": ""}]
        historical = [{"id": 1, "teams": ["Raimon"]}]
        latest = [{"id": 2, "teams": ["Raimon"]}]
        result, metrics = im.merge_teams(seed, historical, latest)
        self.assertEqual(result, seed)
        self.assertEqual(metrics["membershipsAdded"], 0)

    def test_viewer_link_is_tied_to_same_row_number(self):
        html = """<table><tr><th>No.</th><th>Name</th></tr>
        <tr><td>123</td><td><a href="/en/chara_model_view/?q=abc">Foo</a></td></tr>
        <tr><td>124</td><td><a href="/en/chara_model_view/?q=def">Bar</a></td></tr></table>"""
        links = im.viewer_links(html, im.zukan.SOURCE_URL)
        self.assertIn("q=abc", links[123])
        self.assertIn("q=def", links[124])
        self.assertNotEqual(links[123], links[124])

if __name__ == "__main__":
    unittest.main()
