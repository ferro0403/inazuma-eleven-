#!/usr/bin/env python3
"""Build the exact playerId -> internalCode -> Victory Road body-profile map.

This script deliberately keeps body metadata separate from data/players.js.

Authoritative chain:
    Zukan public No. (playerId)
    -> same-row chara_param/chara_model_view q
    -> internalCode (cXXXXXXXX)
    -> data/victory_road_body_profiles.json
    -> bodyId / bodyTypeIdx / bodyMeshProfile

No player name, gender, height, image shape or hand-written size class is used
to guess a body type.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import importlib.util
import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAYERS = ROOT / "data/players.js"
DEFAULT_BODY_CATALOG = ROOT / "data/victory_road_body_profiles.json"
DEFAULT_OUTPUT = ROOT / "data/player_body_profiles.json"
DEFAULT_REPORT = ROOT / "data/player_body_profiles_report.json"
DEFAULT_CACHE = ROOT / "data/zukan_internal_codes.json"
DEFAULT_BROWSER_PROFILE = ROOT / ".playwright-profile-body-catalog"
DEFAULT_ZUKAN_URL = "https://zukan.inazuma.jp/en/chara_list/?per_page=50"

INTERNAL_CODE_RE = re.compile(r"c\d{8}", re.I)
PLAYERS_PAYLOAD_RE = re.compile(
    r"globalThis\.INAZUMA_PLAYERS\s*=\s*(\[[\s\S]*\]);\s*$"
)
SOURCE_RE = re.compile(r"^//\s*Source:\s*(\S+)\s*$", re.M)

BODY_MODEL_BY_TYPE = {
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


def _load_extract_players_module():
    path = ROOT / "scripts/extract_players.py"
    spec = importlib.util.spec_from_file_location("inazuma_extract_players", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


extract_players = _load_extract_players_module()


def read_players(path: Path) -> list[dict[str, object]]:
    text = path.read_text(encoding="utf-8")
    match = PLAYERS_PAYLOAD_RE.search(text)
    if not match:
        raise RuntimeError(f"Cannot find INAZUMA_PLAYERS payload in {path}")
    payload = json.loads(match.group(1))
    if not isinstance(payload, list):
        raise RuntimeError(f"{path} does not contain a player array")
    return payload


def source_url_from_players_js(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = SOURCE_RE.search(text)
    if not match:
        raise RuntimeError(
            f"{path} has no // Source: URL. Pass --url explicitly."
        )
    return match.group(1)


def decode_zukan_q(value: str) -> dict[str, object] | None:
    """Decode Zukan's base64url + byte-complement q parameter."""
    if not value:
        return None
    try:
        decoded = unquote(value)
        padded = decoded + ("=" * (-len(decoded) % 4))
        inverted = base64.urlsafe_b64decode(padded.encode("ascii"))
        original = bytes((~byte) & 0xFF for byte in inverted)
        payload = json.loads(original.decode("utf-8"))
    except (UnicodeDecodeError, UnicodeEncodeError, ValueError, json.JSONDecodeError, binascii.Error):
        return None
    return payload if isinstance(payload, dict) else None


def internal_codes_from_href(href: str, base_url: str) -> set[str]:
    if not href:
        return set()
    absolute = urljoin(base_url, href)
    parsed = urlparse(absolute)
    if "/chara_param/" not in parsed.path and "/chara_model_view/" not in parsed.path:
        return set()

    query = parse_qs(parsed.query)
    payload = decode_zukan_q(query.get("q", [""])[0])
    if not payload:
        return set()

    found: set[str] = set()
    for key in ("character_id", "filter_chara_id_str"):
        raw = payload.get(key)
        candidates = raw if isinstance(raw, list) else [raw]
        for candidate in candidates:
            code = str(candidate or "").strip().casefold()
            if INTERNAL_CODE_RE.fullmatch(code):
                found.add(code)
    return found


def extract_number_code_map(
    markup: str,
    base_url: str,
) -> tuple[dict[int, str], dict[int, list[str]]]:
    """Extract only public No. and q links that occur in the same result row."""
    root = extract_players.parse_document(markup)
    mapping: dict[int, str] = {}
    conflicts: dict[int, list[str]] = {}

    for table in root.descendants("table"):
        rows = list(table.descendants("tr"))
        headers: list[str] = []
        header_index = -1

        for index, row in enumerate(rows):
            cells = [
                child for child in row.children
                if isinstance(child, extract_players.Node)
                and child.tag in {"th", "td"}
            ]
            candidate = [cell.text() for cell in cells]
            normalized = [extract_players.normalize_label(value) for value in candidate]
            if ("no." in normalized or "no" in normalized) and "name" in normalized:
                headers = normalized
                header_index = index
                break

        if header_index < 0:
            continue

        number_index = next(
            (i for i, label in enumerate(headers) if label in {"no.", "no"}),
            None,
        )
        if number_index is None:
            continue

        for row in rows[header_index + 1:]:
            cells = [
                child for child in row.children
                if isinstance(child, extract_players.Node)
                and child.tag in {"th", "td"}
            ]
            if number_index >= len(cells):
                continue
            raw_number = cells[number_index].text().strip()
            if not raw_number.isdigit():
                continue
            player_id = int(raw_number)

            codes: set[str] = set()
            for link in row.descendants("a"):
                codes.update(internal_codes_from_href(
                    link.attrs.get("href", ""),
                    base_url,
                ))

            if len(codes) == 1:
                code = next(iter(codes))
                previous = mapping.get(player_id)
                if previous is not None and previous != code:
                    conflicts[player_id] = sorted({previous, code})
                    mapping.pop(player_id, None)
                elif player_id not in conflicts:
                    mapping[player_id] = code
            elif len(codes) > 1:
                conflicts[player_id] = sorted(codes)
                mapping.pop(player_id, None)

    return mapping, conflicts


def load_body_catalog(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"{path} does not contain an object")
    if not isinstance(payload.get("characters"), dict):
        raise RuntimeError(f"{path} has no characters map")
    if not isinstance(payload.get("bodies"), dict):
        raise RuntimeError(f"{path} has no bodies map")
    return payload


def body_kind(body_type_idx: int | None) -> str:
    if body_type_idx is None:
        return "unresolved"
    if 0 <= body_type_idx <= 17:
        return "human"
    if body_type_idx == 101:
        return "animal"
    if body_type_idx == 201:
        return "vehicle"
    return "other"


def resolve_profile(
    player: dict[str, object],
    internal_code: str | None,
    catalog: dict[str, object],
) -> tuple[dict[str, object], str | None]:
    code = (internal_code or "").strip().casefold()
    result: dict[str, object] = {
        "internalCode": code or None,
        "bodyId": None,
        "bodyTypeIdx": None,
        "bodyModel": None,
        "bodyMeshProfile": None,
        "bodyPath": None,
        "bodyKind": "unresolved",
        "supportsStandardUniform": False,
        "source": "unresolved",
    }

    if not code:
        return result, "missing_internal_code"

    characters = catalog["characters"]
    bodies = catalog["bodies"]
    assert isinstance(characters, dict)
    assert isinstance(bodies, dict)

    body_id = characters.get(code)
    if body_id is None:
        return result, "internal_code_not_in_victory_road_catalog"

    body = bodies.get(str(body_id))
    if not isinstance(body, dict):
        return result, "body_definition_missing"

    try:
        body_type_idx = int(body["bodyProfile"])
        body_mesh_profile = int(body["bodyMeshProfile"])
    except (KeyError, TypeError, ValueError):
        return result, "invalid_body_definition"

    model = BODY_MODEL_BY_TYPE.get(body_type_idx)
    result.update({
        "bodyId": int(body_id),
        "bodyTypeIdx": body_type_idx,
        "bodyModel": model,
        "bodyMeshProfile": body_mesh_profile,
        "bodyPath": str(body.get("bodyPath") or "") or None,
        "bodyKind": body_kind(body_type_idx),
        "supportsStandardUniform": 0 <= body_type_idx <= 17,
        "source": "victory-road",
    })
    return result, None


def build_player_map(
    players: list[dict[str, object]],
    codes: dict[int, str],
    catalog: dict[str, object],
    conflicts: dict[int, list[str]] | None = None,
) -> tuple[dict[str, dict[str, object]], dict[str, object]]:
    conflicts = conflicts or {}
    output: dict[str, dict[str, object]] = {}
    unresolved: list[dict[str, object]] = []
    special: list[dict[str, object]] = []
    internal_resolved = 0
    body_resolved = 0

    seen_ids: set[int] = set()
    duplicate_ids: list[int] = []

    for player in players:
        player_id = int(player["id"])
        if player_id in seen_ids:
            duplicate_ids.append(player_id)
            continue
        seen_ids.add(player_id)

        code = None if player_id in conflicts else codes.get(player_id)
        if code:
            internal_resolved += 1

        profile, reason = resolve_profile(player, code, catalog)
        if profile["bodyTypeIdx"] is not None:
            body_resolved += 1

        output[str(player_id)] = profile

        if player_id in conflicts:
            unresolved.append({
                "playerId": player_id,
                "name": str(player.get("name") or ""),
                "reason": "conflicting_internal_codes",
                "codes": conflicts[player_id],
            })
        elif reason:
            unresolved.append({
                "playerId": player_id,
                "name": str(player.get("name") or ""),
                "internalCode": code,
                "reason": reason,
            })

        if profile["bodyKind"] in {"animal", "vehicle", "other"}:
            special.append({
                "playerId": player_id,
                "name": str(player.get("name") or ""),
                "internalCode": profile["internalCode"],
                "bodyTypeIdx": profile["bodyTypeIdx"],
                "bodyKind": profile["bodyKind"],
            })

    report = {
        "version": 1,
        "totals": {
            "players": len(seen_ids),
            "internalCodesResolved": internal_resolved,
            "bodyTypesResolved": body_resolved,
            "unresolved": len(unresolved),
            "specialBodies": len(special),
            "duplicatePlayerIds": len(set(duplicate_ids)),
            "manualAssignments": 0,
        },
        "conflictingZukanRows": {
            str(key): value for key, value in sorted(conflicts.items())
        },
        "duplicatePlayerIds": sorted(set(duplicate_ids)),
        "specialBodies": special,
        "unresolved": unresolved,
    }
    return output, report


def write_json_atomic(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def read_cache(path: Path) -> tuple[dict[int, str], dict[int, list[str]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    raw_codes = payload.get("codes", {})
    raw_conflicts = payload.get("conflicts", {})
    if not isinstance(raw_codes, dict) or not isinstance(raw_conflicts, dict):
        raise RuntimeError(f"Invalid Zukan cache: {path}")
    codes = {int(key): str(value).casefold() for key, value in raw_codes.items()}
    conflicts = {
        int(key): [str(code).casefold() for code in value]
        for key, value in raw_conflicts.items()
        if isinstance(value, list)
    }
    return codes, conflicts


def scrape_zukan_codes(
    source_url: str,
    timeout: float,
    delay: float,
    headed: bool,
    profile: Path,
) -> tuple[dict[int, str], dict[int, list[str]]]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError(
            "Playwright is required. Run: pip install -r requirements.txt "
            "and: playwright install chromium"
        ) from error

    timeout_ms = int(timeout * 1000)
    all_codes: dict[int, str] = {}
    all_conflicts: dict[int, list[str]] = {}

    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(profile),
            headless=not headed,
            user_agent=extract_players.USER_AGENT,
            viewport={"width": 1440, "height": 1000},
        )
        page = context.pages[0] if context.pages else context.new_page()
        first_markup = extract_players.browser_markup(page, source_url, timeout_ms)
        pagination = extract_players.pagination_urls(first_markup, source_url)
        last_page = max(
            (extract_players.page_number(url) for url in pagination),
            default=1,
        )
        total = extract_players.reported_total(first_markup)
        requested_per_page = int(
            parse_qs(urlparse(source_url).query).get("per_page", ["50"])[0]
        )
        if total and requested_per_page > 0:
            last_page = max(
                last_page,
                (total + requested_per_page - 1) // requested_per_page,
            )

        for page_number in range(1, last_page + 1):
            url = extract_players.page_url(source_url, page_number)
            markup = first_markup if page_number == 1 else extract_players.browser_markup(
                page, url, timeout_ms
            )
            mapping, conflicts = extract_number_code_map(markup, url)

            for player_id, code in mapping.items():
                previous = all_codes.get(player_id)
                if previous is not None and previous != code:
                    all_conflicts[player_id] = sorted({previous, code})
                    all_codes.pop(player_id, None)
                elif player_id not in all_conflicts:
                    all_codes[player_id] = code

            for player_id, values in conflicts.items():
                merged = set(all_conflicts.get(player_id, []))
                if player_id in all_codes:
                    merged.add(all_codes.pop(player_id))
                merged.update(values)
                all_conflicts[player_id] = sorted(merged)

            print(
                f"Zukan page {page_number}/{last_page}: "
                f"{len(mapping)} ids, {len(conflicts)} conflicts"
            )
            if delay > 0 and page_number < last_page:
                page.wait_for_timeout(int(delay * 1000))

        context.close()

    return all_codes, all_conflicts


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=Path, default=DEFAULT_PLAYERS)
    parser.add_argument("--body-catalog", type=Path, default=DEFAULT_BODY_CATALOG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--url")
    parser.add_argument("--reuse-zukan-cache", action="store_true")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--delay", type=float, default=0.25)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    players = read_players(args.players)
    catalog = load_body_catalog(args.body_catalog)
    source_url = args.url or DEFAULT_ZUKAN_URL

    if args.reuse_zukan_cache:
        if not args.cache.exists():
            raise RuntimeError(
                f"--reuse-zukan-cache requested but cache is missing: {args.cache}"
            )
        codes, conflicts = read_cache(args.cache)
    else:
        codes, conflicts = scrape_zukan_codes(
            source_url=source_url,
            timeout=args.timeout,
            delay=args.delay,
            headed=args.headed,
            profile=DEFAULT_BROWSER_PROFILE,
        )
        write_json_atomic(args.cache, {
            "version": 1,
            "sourceUrl": source_url,
            "codes": {str(key): value for key, value in sorted(codes.items())},
            "conflicts": {
                str(key): value for key, value in sorted(conflicts.items())
            },
        })

    player_map, report = build_player_map(players, codes, catalog, conflicts)
    report["sourceUrl"] = source_url
    report["bodyCatalogSource"] = catalog.get("source")

    write_json_atomic(args.output, player_map)
    write_json_atomic(args.report, report)

    totals = report["totals"]
    print(
        f"Wrote {totals['bodyTypesResolved']}/{totals['players']} exact body profiles "
        f"to {args.output}; unresolved={totals['unresolved']}"
    )
    print(f"Report: {args.report}")

    return 0 if totals["unresolved"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
