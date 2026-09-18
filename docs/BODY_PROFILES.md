# Victory Road body profiles

This pipeline keeps Victory Road body metadata separate from the original Zukan player dataset.

## Authority chain

The mapping is intentionally mechanical:

1. data/players.js provides the public Zukan No. used as playerId.
2. The script crawls the full unfiltered Zukan list because players.js is cumulative across extraction runs.
3. The same Zukan result row exposes a chara_param and/or chara_model_view link.
4. Its q parameter is base64url data whose bytes are complemented with XOR/NOT 0xFF.
5. The decoded JSON contains either filter_chara_id_str or character_id.
6. That value is the Victory Road internalCode, for example c01000010.
7. data/victory_road_body_profiles.json maps the internalCode to the real Victory Road body.
8. bodyProfile is exported as bodyTypeIdx.

No name matching, gender matching, image measurement, three-size classification or manual player assignment is used.

## Files

- scripts/build_body_profile_catalog.py
  - builds the compact Victory Road model/body catalog from Aphrody/NIE's generated chara_model_lookup.json;
  - source is pinned to a specific upstream commit;
  - preserves bodyId, bodyProfile, bodyMeshProfile, body path and skeleton data.

- data/victory_road_body_profiles.json
  - generated exact catalog;
  - currently contains 5,615 cXXXXXXXX character model codes and 35 body definitions;
  - source game data is chara_model_1.03.49.00.cfg.bin.xml.

- scripts/build_player_body_profiles.py
  - crawls the full unfiltered Zukan list and uses the official public No. as the only player join key;
  - pairs public No. and internal code only when both occur in the same result row;
  - joins the code to the Victory Road catalog;
  - writes the final player mapping without modifying players.js.

- data/player_body_profiles.json
  - final generated mapping keyed by playerId;
  - intentionally generated only after a complete successful Zukan pass.

- data/player_body_profiles_report.json
  - local validation report;
  - ignored by Git because it is regenerated.

- data/zukan_internal_codes.json
  - local crawl cache;
  - ignored by Git.

## Standard body types

| bodyTypeIdx | model |
| ---: | --- |
| 0 | base_normal_00 |
| 1 | base_normal_01 |
| 2 | base_normal_02 |
| 3 | base_normal_03 |
| 4 | base_tall_00 |
| 5 | base_bigman_00 |
| 6 | base_bigman_01 |
| 7 | base_tall_01 |
| 8 | base_tall_02 |
| 9 | base_tall_03 |
| 10 | base_tall_04 |
| 11 | base_tall_05 |
| 12 | base_big_00 |
| 13 | base_bigwoman_00 |
| 14 | base_small_00 |
| 15 | base_small_01 |
| 16 | base_elderlyman_00 |
| 17 | base_elderlywoman_00 |

Special Victory Road profiles are not treated as standard human uniforms:

- 101 = animal
- 201 = vehicle

## Verified anchors

The committed Victory Road catalog resolves:

| Zukan player | internalCode | bodyTypeIdx | body model |
| --- | --- | ---: | --- |
| Mark Evans | c01000010 | 0 | base_normal_00 |
| Axel Blaze | c01000100 | 0 | base_normal_00 |
| Jack Wallside | c01000030 | 6 | base_bigman_01 |
| Tod Ironside | c01000050 | 2 | base_normal_02 |

These are regression anchors, not manual assignments.

## Generate or refresh the Victory Road catalog

From the repository root:

    py scripts/build_body_profile_catalog.py

The generator is deterministic for its pinned upstream source.

## Generate the final player mapping

Install browser dependencies if needed:

    pip install -r requirements.txt
    playwright install chromium

First complete crawl of the full Zukan:

    py scripts/build_player_body_profiles.py --headed

If Zukan requires a browser verification, complete it in the persistent Chromium window. A successful crawl writes the local internal-code cache and then the final mapping.

Subsequent runs may reuse the exact cached playerId/internalCode mapping:

    py scripts/build_player_body_profiles.py --reuse-zukan-cache

Exit code is 0 only when every player in the current players.js has an exact body resolution. If any player is unresolved, outputs and report are still written but the process exits with code 2.

## Output shape

data/player_body_profiles.json is keyed by the existing player ID:

    {
      "5": {
        "internalCode": "c01000030",
        "bodyId": 1382133758,
        "bodyTypeIdx": 6,
        "bodyModel": "base_bigman_01",
        "bodyMeshProfile": 6,
        "bodyPath": "_common/c000401/c000401.objbin",
        "bodyKind": "human",
        "supportsStandardUniform": true,
        "source": "victory-road"
      }
    }

Missing data is never guessed. Unresolved entries keep null body fields and source: unresolved.

## Next uniform phase

The body database is the input to uniform resolution, not the final visual replacement.

For a kit such as Raimon Home:

1. resolve the player bodyTypeIdx;
2. resolve the uniform family by its real CRC;
3. select CHARA_PARTS_CLOTHES_INFO with the exact profile;
4. only if the game data has no exact profile, follow the game's profile-0 fallback;
5. use the resolved mesh plus the kit texture;
6. render a proof of concept on non-Raimon characters before integrating anything into the roguelike.

The current work does not modify INAZUMA-ROGUELIKE, gameplay, persistence, IndexedDB, cloud saves or player balancing.
