import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from import_zukan_emblems import build_assignments,name_key

class OfficialEmblemTests(unittest.TestCase):
    def test_exact_matching_preserves_existing_and_all_non_logo_fields(self):
        teams=[{"id":"chrono","name":"Chrono Storm","logoUrl":"","aliases":[],"playerIds":[2,3],"notes":"custom"},
               {"id":"raimon","name":"Raimon","logoUrl":"keep-existing.png","aliases":[],"playerIds":[1],"notes":""},
               {"id":"unmatched","name":"No Matching Team","logoUrl":"","aliases":[],"playerIds":[],"notes":""}]
        emblems=[{"name":"Chrono Storm","imageUrl":"https://cdn.example/chrono.webp"},
                 {"name":"Raimon","imageUrl":"https://cdn.example/raimon.webp"}]
        updated, report=build_assignments(teams,emblems)
        self.assertEqual(report["newLogosAssigned"],1)
        self.assertEqual(updated[0]["logoUrl"],"https://cdn.example/chrono.webp")
        self.assertEqual(updated[1],teams[1])
        self.assertEqual(updated[0]["playerIds"],[2,3])
        self.assertEqual(updated[0]["notes"],"custom")
        self.assertEqual(teams[0]["logoUrl"],"")
        self.assertEqual(updated[2],teams[2])

    def test_ambiguous_alias_never_assigns_logo(self):
        teams=[{"id":"a","name":"Alpha","logoUrl":"","aliases":["Twin"],"playerIds":[]},
               {"id":"b","name":"Beta","logoUrl":"","aliases":["Twin"],"playerIds":[]}]
        updated, report=build_assignments(teams,[{"name":"Twin","imageUrl":"https://cdn.example/twin.webp"}])
        self.assertEqual([t["logoUrl"] for t in updated],["",""])
        self.assertEqual(len(report["ambiguous"]),2)

    def test_different_emblems_with_identical_name_are_not_guessed(self):
        teams=[{"id":"x","name":"Zeus","logoUrl":"","aliases":[],"playerIds":[]}]
        imgs=[{"name":"Zeus","imageUrl":"https://cdn.example/a.webp"},
              {"name":"zeus","imageUrl":"https://cdn.example/b.webp"}]
        updated, report=build_assignments(teams,imgs)
        self.assertEqual(updated,teams)
        self.assertEqual(len(report["ambiguous"]),1)

    def test_source_name_is_not_fuzzy_matched(self):
        teams=[{"id":"m","name":"Milky Way Charter","logoUrl":"","aliases":[],"playerIds":[]}]
        updated, report=build_assignments(teams,[{"name":"Milky Way","imageUrl":"https://cdn.example/a.webp"}])
        self.assertEqual(updated,teams)
        self.assertEqual(report["newLogosAssigned"],0)

    def test_unicode_apostrophe_normalization(self):
        self.assertEqual(name_key("  Zanark’s   Domain "), name_key("Zanark's Domain"))

if __name__=="__main__":
    unittest.main()
