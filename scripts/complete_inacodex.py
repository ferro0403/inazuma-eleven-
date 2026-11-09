#!/usr/bin/env python3
"""Add only missing Zukan IDs and front-facing static WebPs; auto-fill Team Manager."""
import argparse
import json
import re
import time
import unicodedata
from pathlib import Path
from urllib.parse import urljoin, urlparse
import extract_players as zukan

ROOT = Path(__file__).resolve().parents[1]
PLAYERS = ROOT / "data/players.js"
TEAMS = ROOT / "data/teams.js"
REPORT = ROOT / "data/inacodex-completion-report.json"
CACHE = ROOT / ".inacodex-front-cache.json"

def load_teams(path):
    s = path.read_text(encoding="utf-8")
    m = re.search(r"globalThis\.INAZUMA_TEAMS\s*=\s*", s)
    if not m:
        raise ValueError("Missing team array assignment")
    value, end = json.JSONDecoder().raw_decode(s[m.end():])
    if not isinstance(value, list) or s[m.end() + end:].strip().rstrip(";").strip():
        raise ValueError("Invalid team array")
    return value

def viewer_links(html, base):
    """Associate each public Zukan number with its own row's full-body viewer."""
    root = zukan.parse_document(html)
    links = {}
    for table in root.descendants("table"):
        headers = None
        for row in table.descendants("tr"):
            cells = [c for c in row.children if isinstance(c, zukan.Node) and c.tag in {"th", "td"}]
            fields = [zukan.normalize_label(c.text()) for c in cells]
            if "name" in fields and ("no." in fields or "no" in fields):
                headers = fields
                continue
            if headers is None:
                continue
            index = headers.index("no.") if "no." in headers else headers.index("no")
            if index >= len(cells) or not cells[index].text().isdigit():
                continue
            number = int(cells[index].text())
            candidates = set()
            for a in row.descendants("a"):
                url = urljoin(base, a.attrs.get("href", ""))
                part = urlparse(url)
                if part.hostname == "zukan.inazuma.jp" and "/chara_model_view/" in part.path and part.query:
                    candidates.add(url)
            if len(candidates) != 1:
                raise ValueError(f"Player {number} has {len(candidates)} viewer links")
            url = next(iter(candidates))
            if number in links and links[number] != url:
                raise ValueError(f"Conflicting viewer for player {number}")
            links[number] = url
    return links

def slug(name):
    text = unicodedata.normalize("NFKD", name.casefold())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", text)) or "team"

def team_key(name):
    return str(name).strip().casefold()

def merge_teams(seed, historical, added):
    teams = json.loads(json.dumps(seed))
    lookup = {}
    used = set()
    for team in teams:
        identifier = team["id"]
        if identifier in used:
            raise ValueError(f"Duplicate existing team {identifier}")
        used.add(identifier)
        for label in [team["name"], *(team.get("aliases") or [])]:
            key = team_key(label)
            if key in lookup and lookup[key] is not team:
                raise ValueError(f"Ambiguous team alias: {label}")
            lookup[key] = team
    new_team_ids = set()
    all_players = [*historical, *added]
    for player in all_players:
        for name in player.get("teams") or []:
            key = team_key(name)
            if not key or key in lookup:
                continue
            base = slug(name)
            candidate = base
            suffix = 2
            while candidate in used:
                candidate = f"{base}-{suffix}"
                suffix += 1
            used.add(candidate)
            team = {"id": candidate, "name": name, "logoUrl": "", "aliases": [],
                    "playerIds": [], "notes": ""}
            teams.append(team)
            lookup[key] = team
            new_team_ids.add(candidate)
    old_ids = {int(p["id"]) for p in historical}
    memberships = 0
    touched = set()
    for player in all_players:
        identifier = int(player["id"])
        for name in player.get("teams") or []:
            team = lookup[team_key(name)]
            if identifier in old_ids and team["id"] not in new_team_ids:
                continue
            if identifier not in team["playerIds"]:
                team["playerIds"].append(identifier)
                memberships += 1
                touched.add(team["id"])
    teams[len(seed):] = sorted(teams[len(seed):], key=lambda t: (t["name"].casefold(), t["id"]))
    return teams, {"teamsBefore": len(seed), "teamsAfter": len(teams),
                   "teamsCreated": len(new_team_ids), "teamsUpdated": len(touched),
                   "membershipsAdded": memberships,
                   "newTeams": [{"id": t["id"], "name": t["name"], "roster": len(t["playerIds"])}
                                for t in teams if t["id"] in new_team_ids]}

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="Write both files only if 100% complete")
    ap.add_argument("--delay", type=float, default=0.18)
    ap.add_argument("--timeout", type=float, default=50)
    ap.add_argument("--min-count", type=int, default=5000)
    args = ap.parse_args()
    historical = zukan.load_players(PLAYERS)
    seeds = load_teams(TEAMS)
    viewers = {}
    def collect(html, page_url):
        for identifier, url in viewer_links(html, page_url).items():
            if identifier in viewers and viewers[identifier] != url:
                raise ValueError(f"Viewer conflict for player {identifier}")
            viewers[identifier] = url
    print("Reading complete official Zukan list...", flush=True)
    official = zukan.scrape(zukan.SOURCE_URL, args.timeout, args.delay, False,
                           ROOT / ".inacodex-browser-profile", on_page=collect)
    if len(official) < args.min_count or len(viewers) < len(official):
        raise ValueError(f"Incomplete scan: {len(official)} player rows, {len(viewers)} viewers")
    existing_ids = {int(p["id"]) for p in historical}
    fresh = [dict(p) for p in official if int(p["id"]) not in existing_ids]
    print(f"Existing players: {len(historical)}; official: {len(official)}; new: {len(fresh)}", flush=True)
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    missing = []
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(locale="en-US")
        try:
            for n, player in enumerate(fresh, 1):
                identifier = str(player["id"])
                body = cache.get(identifier, "")
                if not body:
                    try:
                        page.goto(viewers[int(player["id"])], wait_until="domcontentloaded",
                                  timeout=int(args.timeout * 1000))
                        image = page.locator('img[src*="_r0_fullbody.webp"]').first
                        image.wait_for(state="attached", timeout=10000)
                        body = image.get_attribute("src") or ""
                    except Exception as error:
                        print(f"Missing image {identifier}: {type(error).__name__}", flush=True)
                if urlparse(body).hostname == "dxi4wb638ujep.cloudfront.net" and body.split("?")[0].endswith("_r0_fullbody.webp"):
                    player["frontFullbodyUrl"] = body
                    cache[identifier] = body
                else:
                    missing.append(player["id"])
                if n % 100 == 0 or n == len(fresh):
                    CACHE.write_text(json.dumps(cache, ensure_ascii=False) + "\n", encoding="utf-8")
                    print(f"Front images {n}/{len(fresh)}, failures {len(missing)}", flush=True)
                if args.delay:
                    time.sleep(args.delay)
        finally:
            browser.close()
    no_portraits = [p["id"] for p in fresh if not p.get("imageUrl")]
    combined = sorted([*historical, *fresh], key=lambda p: int(p["id"]))
    teams, team_report = merge_teams(seeds, historical, fresh)
    report = {"existingPlayers": len(historical), "officialPlayers": len(official),
              "newPlayerIds": len(fresh), "totalPlayers": len(combined),
              "frontImagesMissing": missing, "portraitsMissing": no_portraits,
              "applied": False, **team_report}
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if missing or no_portraits:
        raise ValueError(f"Import blocked; {len(missing)} fullbody and {len(no_portraits)} portrait images missing")
    if args.apply:
        # Stage and validate both, then let one Git commit atomically persist them.
        pstage, tstage = PLAYERS.with_suffix(".staged.js"), TEAMS.with_suffix(".staged.js")
        zukan.write_players(combined, pstage, zukan.SOURCE_URL)
        tstage.write_text("globalThis.INAZUMA_TEAMS = " +
                          json.dumps(teams, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
        if len(zukan.load_players(pstage)) != len(combined) or len(load_teams(tstage)) != len(teams):
            raise ValueError("Staged database readback failed")
        pstage.replace(PLAYERS)
        tstage.replace(TEAMS)
        report["applied"] = True
        REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("newTeams", "frontImagesMissing", "portraitsMissing")},
                     indent=2), flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
