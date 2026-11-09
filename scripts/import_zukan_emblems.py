#!/usr/bin/env python3
"""Add only unambiguous Zukan emblem images to empty InaCodex team logo fields.

Official source: https://zukan.inazuma.jp/en/item/emblem/
No fuzzy matching. No edits to teams that already have logoUrl. No new teams.
"""
from __future__ import annotations
import argparse
import copy
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from complete_inacodex import load_teams

TEAMS = ROOT / "data" / "teams.js"
REPORT = ROOT / "data" / "inacodex-emblems-report.json"
SOURCE = "https://zukan.inazuma.jp/en/item/emblem/"
MIN_EXPECTED = 327  # Official Zukan count, 9 Nov 2026
PAGE_SIZE = 50


def name_key(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    value = value.replace("’", "'").replace("‘", "'")
    value = re.sub(r"\\s+", " ", value)
    return value.strip()


def build_assignments(teams: list[dict], emblems: list[dict]):
    """Return a new team list, report. Preserve all old fields and existing logo URLs."""
    output = copy.deepcopy(teams)
    # Multiple emblems with the same normalized name are ambiguous.
    candidates = defaultdict(set)
    for emblem in emblems:
        if isinstance(emblem, dict) and emblem.get("name") and emblem.get("imageUrl"):
            candidates[name_key(emblem["name"])].add(emblem["imageUrl"])
    # An alias matching multiple teams is also ambiguous.
    owners = defaultdict(set)
    for i, team in enumerate(output):
        for text in [team.get("name"), *(team.get("aliases") or [])]:
            if text:
                owners[name_key(text)].add(i)
    added = []
    ambiguous = []
    not_found = []
    already_set = 0
    for idx, team in enumerate(output):
        if team.get("logoUrl"):
            already_set += 1
            continue
        names = [team.get("name"), *(team.get("aliases") or [])]
        options = set()
        reason = None
        for raw in names:
            key = name_key(raw)
            if not key or key not in candidates:
                continue
            if len(owners.get(key, set())) != 1:
                reason = "team_alias_collision"
            elif len(candidates[key]) != 1:
                reason = "multiple_emblems_same_name"
            else:
                options.update(candidates[key])
        if reason or len(options) > 1:
            ambiguous.append({"team": team.get("name"), "reason": reason or "conflicting_alias_matches"})
        elif len(options) == 1:
            url = next(iter(options))
            team["logoUrl"] = url
            added.append({"id": team.get("id"), "name": team.get("name"), "logoUrl": url})
        else:
            not_found.append(team.get("name"))
    report = {"officialEmblemRecords": len(emblems), "uniqueEmblemNames": len(candidates),
              "teamsTotal": len(teams), "previousLogosPreserved": already_set,
              "newLogosAssigned": len(added), "matched": added,
              "ambiguous": ambiguous, "notMatched": not_found}
    return output, report


def collect_emblems(timeout: int = 30000) -> list[dict]:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(locale="en-US")
        found = []
        try:
            for number in range(1, (MIN_EXPECTED + PAGE_SIZE - 1) // PAGE_SIZE + 1):
                url = SOURCE if number == 1 else SOURCE + "?page=" + str(number)
                page.goto(url, wait_until="domcontentloaded", timeout=timeout)
                page.locator("ul.itemListBox.uniform img[alt]").first.wait_for(timeout=timeout)
                rows = page.evaluate("""() => [...document.querySelectorAll('ul.itemListBox.uniform li')].map(li => {
                  const img = li.querySelector('img[alt]');
                  if (!img) return null;
                  const webp = li.querySelector('source[type="image/webp"]');
                  return {name: (img.getAttribute('alt') || '').trim(),
                    imageUrl: webp?.getAttribute('srcset') || img.getAttribute('src') || ''};
                }).filter(Boolean)""")
                if not rows:
                    raise ValueError(f"No emblems on Zukan page {number}")
                if number < 7 and len(rows) != PAGE_SIZE:
                    raise ValueError(f"Unexpected page {number} item count: {len(rows)}")
                for row in rows:
                    address = urlparse(row["imageUrl"])
                    if address.hostname != "dxi4wb638ujep.cloudfront.net" or not address.path.endswith((".webp", ".png")):
                        raise ValueError(f"Unverified image URL for {row['name']}: {row['imageUrl']}")
                found.extend(rows)
                print(f"OFFICIAL_EMBLEMS page {number}/7: {len(rows)}; cumulative {len(found)}", flush=True)
        finally:
            browser.close()
    if len(found) != MIN_EXPECTED:
        raise ValueError(f"Official emblem inventory incomplete: {len(found)} != {MIN_EXPECTED}")
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually update only empty team logo URLs")
    args = parser.parse_args()
    before = load_teams(TEAMS)
    collected = collect_emblems()
    after, report = build_assignments(before, collected)
    if len(after) != len(before):
        raise AssertionError("Team count changed unexpectedly")
    by_id = {t["id"]: t for t in before}
    for t in after:
        old = by_id[t["id"]]
        if old.get("logoUrl") and old != t:
            raise AssertionError(f"Existing team changed: {t['id']}")
        for k in set(old) | set(t):
            if k != "logoUrl" and old.get(k) != t.get(k):
                raise AssertionError(f"Non-logo field changed: {t['id']}.{k}")
    print("EMBLEM_REPORT", json.dumps({k:v for k,v in report.items() if k not in ("matched","notMatched","ambiguous")}), flush=True)
    if report["newLogosAssigned"] < 10:
        raise ValueError("Too few exact matches; no data written")
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.apply:
        temporary=TEAMS.with_suffix(".emblems.staged.js")
        temporary.write_text("globalThis.INAZUMA_TEAMS = "+json.dumps(after,ensure_ascii=False,indent=2)+";\n", encoding="utf-8")
        if load_teams(temporary) != after:
            raise AssertionError("Staged readback failed")
        temporary.replace(TEAMS)
        print("EMBLEM_APPLIED",len(report["matched"]),flush=True)
    else:
        print("Dry run only. Pass --apply to write data/teams.js.",flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
