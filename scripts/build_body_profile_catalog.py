#!/usr/bin/env python3
"""Build data/body_profiles.json from a niers chara_model_lookup.json export.

The source lookup is generated from Victory Road CHARA_MODEL_INFO / CHARA_BODY_INFO.
This script intentionally keeps body profile (type_idx) separate from mesh profile:
uniform resolution uses body profile, while mesh profile is useful for model diagnostics.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

DEFAULT_OUTPUT = Path("data/body_profiles.json")
INTERNAL_CODE_RE = re.compile(r"/(c\d{8})(?:_[^/]+)?/\1(?:_[^/.]+)?\.g4md$", re.I)
FALLBACK_CODE_RE = re.compile(r"/(c\d{8})(?:_[^/.]+)?\.g4md$", re.I)

PROFILE_BASE_MODELS = {
    0: "base_normal_00",
    1: "base_normal_01",
    2: "base_normal_02",
    3: "base_normal_03",
    4: "base_tall_00",
    5: "base_bigman_00",
    6: "base_bigman_01",
    7: "base_tall_01",
    8: "base_tall_02",
    9: "base_tall_03",
    10: "base_tall_04",
    11: "base_tall_05",
    12: "base_big_00",
    13: "base_bigwoman_00",
    14: "base_small_00",
    15: "base_small_01",
    16: "base_elderlyman_00",
    17: "base_elderlywoman_00",
}


def internal_code_from_model_path(path: str) -> str | None:
    normalized = path.replace("\\", "/")
    match = INTERNAL_CODE_RE.search(normalized) or FALLBACK_CODE_RE.search(normalized)
    return match.group(1).lower() if match else None


def build_catalog(source: dict, source_meta: dict | None = None) -> dict:
    models = source.get("models")
    if not isinstance(models, dict):
        raise ValueError("Source lookup must contain an object named 'models'")

    by_code: dict[str, dict[str, int]] = {}
    for lookup_path, raw in models.items():
        if not isinstance(raw, dict):
            continue
        model_path = str(raw.get("model_path") or lookup_path)
        code = internal_code_from_model_path(model_path)
        if not code:
            continue

        try:
            profile = int(raw["body_profile"])
            mesh_profile = int(raw["body_mesh_profile"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Invalid body profile data for {model_path}") from error

        row = {"profile": profile, "meshProfile": mesh_profile}
        previous = by_code.get(code)
        if previous is not None and previous != row:
            raise ValueError(
                f"Conflicting body profiles for {code}: {previous!r} vs {row!r}"
            )
        by_code[code] = row

    distribution: dict[str, int] = {}
    for row in by_code.values():
        key = str(row["profile"])
        distribution[key] = distribution.get(key, 0) + 1

    meta = {
        "schemaVersion": 1,
        "description": (
            "Victory Road character body-profile catalog. profile is CHARA_BODY_INFO "
            "type_idx and is the value used to resolve compatible uniform meshes. "
            "meshProfile is retained separately because it differs for some characters."
        ),
        "gameDataSource": source.get("source"),
        "characterCount": len(by_code),
        "profileDistribution": distribution,
    }
    if source_meta:
        meta["source"] = source_meta

    return {
        "_meta": meta,
        "profiles": {
            str(profile): {"baseModel": base_model}
            for profile, base_model in PROFILE_BASE_MODELS.items()
        },
        "byInternalCode": dict(sorted(by_code.items())),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "lookup",
        type=Path,
        help="Path to niers plugins/niers-blender/chara_model_lookup.json",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    source = json.loads(args.lookup.read_text(encoding="utf-8"))
    catalog = build_catalog(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {catalog['_meta']['characterCount']} body profiles to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
