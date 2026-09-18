#!/usr/bin/env python3
"""Build the compact Victory Road character body-profile catalog.

The authoritative source is aphrody-code/nie's generated chara_model lookup,
which comes from Victory Road's chara_model_*.cfg.bin data. The output keeps
the game's own character -> body_id -> body profile relationship rather than
guessing body types from names or rendered images.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.request import Request, urlopen

UPSTREAM_REPOSITORY = "aphrody-code/nie"
UPSTREAM_COMMIT = "e946d46aff683ec026beea2b578614e5ec570961"
UPSTREAM_PATH = "plugins/niers-blender/chara_model_lookup.json"
DEFAULT_SOURCE = (
    f"https://raw.githubusercontent.com/{UPSTREAM_REPOSITORY}/"
    f"{UPSTREAM_COMMIT}/{UPSTREAM_PATH}"
)
DEFAULT_OUTPUT = Path("data/victory_road_body_profiles.json")
CHARACTER_RE = re.compile(r"/(c\d{8})/", re.I)

PROFILE_BASE_MODELS = {
    "0": "base_normal_00",
    "1": "base_normal_01",
    "2": "base_normal_02",
    "3": "base_normal_03",
    "4": "base_tall_00",
    "5": "base_bigman_00",
    "6": "base_bigman_01",
    "7": "base_tall_01",
    "8": "base_tall_02",
    "9": "base_tall_03",
    "10": "base_tall_04",
    "11": "base_tall_05",
    "12": "base_big_00",
    "13": "base_bigwoman_00",
    "14": "base_small_00",
    "15": "base_small_01",
    "16": "base_elderlyman_00",
    "17": "base_elderlywoman_00",
}


def read_source(source: str) -> str:
    if source.startswith(("http://", "https://")):
        request = Request(source, headers={"User-Agent": "inazuma-body-catalog/1.0"})
        with urlopen(request, timeout=60) as response:
            return response.read().decode("utf-8")
    return Path(source).read_text(encoding="utf-8")


def build_catalog(payload: dict[str, object]) -> dict[str, object]:
    models = payload.get("models")
    if not isinstance(models, dict):
        raise RuntimeError("Source lookup has no models object")

    characters: dict[str, int] = {}
    bodies: dict[str, dict[str, object]] = {}

    for model_path, raw in models.items():
        if not isinstance(raw, dict):
            continue
        match = CHARACTER_RE.search(str(model_path))
        if not match:
            continue

        code = match.group(1).casefold()
        body_id = int(raw.get("body_id", 0))
        body = {
            "bodyProfile": int(raw.get("body_profile", 0)),
            "bodyMeshProfile": int(raw.get("body_mesh_profile", 0)),
            "bodyPath": str(raw.get("body_path", "")),
            "skeleton": str(raw.get("g4sk_stem", "")),
            "skeletonPath": str(raw.get("g4sk_path", "")),
        }

        previous_body_id = characters.get(code)
        if previous_body_id is not None and previous_body_id != body_id:
            raise RuntimeError(
                f"Character {code} maps to conflicting body ids: "
                f"{previous_body_id} and {body_id}"
            )
        characters[code] = body_id

        body_key = str(body_id)
        previous_body = bodies.get(body_key)
        if previous_body is not None and previous_body != body:
            raise RuntimeError(f"Body {body_key} has conflicting definitions")
        bodies[body_key] = body

    characters = dict(sorted(characters.items()))
    bodies = dict(sorted(bodies.items(), key=lambda item: int(item[0])))

    profile_counts: dict[str, int] = {}
    for body_id in characters.values():
        profile = str(bodies[str(body_id)]["bodyProfile"])
        profile_counts[profile] = profile_counts.get(profile, 0) + 1
    profile_counts = dict(sorted(profile_counts.items(), key=lambda item: int(item[0])))

    return {
        "version": 1,
        "source": {
            "upstreamRepository": UPSTREAM_REPOSITORY,
            "upstreamCommit": UPSTREAM_COMMIT,
            "upstreamPath": UPSTREAM_PATH,
            "lookupVersion": payload.get("version"),
            "gameDataSource": payload.get("source"),
        },
        "counts": {
            "characters": len(characters),
            "bodies": len(bodies),
        },
        "profileBaseModels": PROFILE_BASE_MODELS,
        "profileCounts": profile_counts,
        "characters": characters,
        "bodies": bodies,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    payload = json.loads(read_source(args.source))
    catalog = build_catalog(payload)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {catalog['counts']['characters']} characters / "
        f"{catalog['counts']['bodies']} bodies to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
