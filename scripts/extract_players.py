#!/usr/bin/env python3
"""Extract every character from the English Inazuma Eleven Player Codex.

The site can reject non-browser requests, so this script uses Playwright Chromium
to render every pagination page. It extracts one record per result row and writes
a browser-ready JavaScript file without downloading portrait files.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, parse_qsl, urlencode, urljoin, urlparse, urlunparse

SOURCE_URL = "https://zukan.inazuma.jp/en/chara_list/"
DEFAULT_OUTPUT = Path("data/players.js")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
FIELD_NAMES = {
    "no.": "id",
    "no": "id",
    "name": "name",
    "nickname": "nickname",
    "game": "game",
    "gender": "gender",
    "element": "element",
    "position": "position",
    "character role": "characterRole",
    "age group": "ageGroup",
    "school year": "schoolYear",
    "team": "teams",
    "description": "description",
}
EXPECTED_FIELDS = tuple(FIELD_NAMES.values())


def clean_text(value: str) -> str:
    value = html.unescape(value).replace("\xa0", " ")
    return re.sub(r"\s+", " ", value).strip()


def normalize_label(value: str) -> str:
    return clean_text(value).rstrip("：:").casefold()


@dataclass
class Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    parent: Node | None = None
    children: list[Node | str] = field(default_factory=list)

    def text_parts(self) -> list[str]:
        parts: list[str] = []
        for child in self.children:
            if isinstance(child, str):
                if clean_text(child):
                    parts.append(clean_text(child))
            else:
                parts.extend(child.text_parts())
        return parts

    def text(self) -> str:
        return clean_text(" ".join(self.text_parts()))

    def descendants(self, tag: str | None = None) -> Iterable[Node]:
        for child in self.children:
            if isinstance(child, Node):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.descendants(tag)

    def class_tokens(self) -> set[str]:
        return set(self.attrs.get("class", "").split())


class DOMParser(HTMLParser):
    VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("document")
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = Node(tag, {key: value or "" for key, value in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in self.VOID_TAGS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self.stack[-1].children.append(data)


def parse_document(markup: str) -> Node:
    parser = DOMParser()
    parser.feed(markup)
    return parser.root


def image_from(node: Node, base_url: str) -> str:
    candidates: list[tuple[int, str]] = []
    for image in node.descendants("img"):
        source = image.attrs.get("src") or image.attrs.get("data-src") or image.attrs.get("data-original")
        if not source:
            srcset = image.attrs.get("srcset", "")
            source = srcset.split(",")[0].strip().split(" ")[0] if srcset else ""
        if not source or source.startswith("data:"):
            continue
        context = " ".join(
            [image.attrs.get("class", ""), image.attrs.get("alt", ""), source]
        ).casefold()
        score = 0
        if any(word in context for word in ("chara", "character", "portrait", "face", "thumb")):
            score += 10
        if any(word in context for word in ("icon", "element", "position", "game", "logo")):
            score -= 10
        candidates.append((score, urljoin(base_url, source)))
    return max(candidates, default=(0, ""), key=lambda item: item[0])[1]


def split_teams(cell: Node) -> list[str]:
    teams: list[str] = []
    # Team names are commonly separated by <br>, links, or block elements.
    for part in cell.text_parts():
        value = clean_text(part)
        if value and value not in {"-", "—"} and value not in teams:
            teams.append(value)
    return teams


def record_from_cells(cells: list[Node], headers: list[str], base_url: str) -> dict[str, object] | None:
    values: dict[str, object] = {field: "" for field in EXPECTED_FIELDS}
    values["teams"] = []
    for index, cell in enumerate(cells):
        if index >= len(headers):
            break
        field_name = FIELD_NAMES.get(normalize_label(headers[index]))
        if not field_name:
            continue
        if field_name == "teams":
            values[field_name] = split_teams(cell)
        else:
            value = cell.text()
            values[field_name] = "" if value in {"-", "—"} else value

    identifier = str(values["id"])
    if not identifier.isdigit() or not values["name"]:
        return None
    values["id"] = int(identifier)
    name_index = next((index for index, heading in enumerate(headers) if normalize_label(heading) == "name"), 0)
    # First inspect the Name cell, then this player's row only. Never borrow an
    # image from the table/page, which could associate another player's portrait.
    values["imageUrl"] = image_from(cells[name_index], base_url)
    if not values["imageUrl"]:
        values["imageUrl"] = image_from(cells[0].parent or cells[0], base_url)
    return values


def extract_table_records(root: Node, base_url: str) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for table in root.descendants("table"):
        rows = list(table.descendants("tr"))
        header_index = -1
        headers: list[str] = []
        for index, row in enumerate(rows):
            candidate = [cell.text() for cell in row.children if isinstance(cell, Node) and cell.tag in {"th", "td"}]
            normalized = {normalize_label(value) for value in candidate}
            if {"no.", "name", "nickname", "description"}.issubset(normalized) or {"no", "name", "nickname", "description"}.issubset(normalized):
                headers = candidate
                header_index = index
                break
        if header_index < 0:
            continue
        for row in rows[header_index + 1 :]:
            cells = [cell for cell in row.children if isinstance(cell, Node) and cell.tag in {"th", "td"}]
            if cells:
                record = record_from_cells(cells, headers, base_url)
                if record:
                    records.append(record)
    return records


def extract_definition_records(root: Node, base_url: str) -> list[dict[str, object]]:
    """Fallback for responsive card/list markup made from labels and values."""
    records: list[dict[str, object]] = []
    candidates: list[Node] = []
    for node in root.descendants():
        class_text = " ".join(node.class_tokens()).casefold()
        if node.tag in {"li", "article", "div"} and "chara" in class_text and any(token in class_text for token in ("item", "card", "row")):
            candidates.append(node)

    for candidate in candidates:
        labels: dict[str, str] = {}
        all_nodes = list(candidate.descendants())
        for index, node in enumerate(all_nodes):
            field_name = FIELD_NAMES.get(normalize_label(node.text()))
            if field_name and index + 1 < len(all_nodes):
                value_node = all_nodes[index + 1]
                if node not in list(value_node.descendants()) and value_node.text():
                    labels[field_name] = value_node.text()
        identifier = labels.get("id", "")
        if identifier.isdigit() and labels.get("name"):
            record: dict[str, object] = {field: labels.get(field, "") for field in EXPECTED_FIELDS}
            record["id"] = int(identifier)
            record["teams"] = [] if labels.get("teams") in {None, "", "-"} else [clean_text(labels["teams"])]
            record["imageUrl"] = image_from(candidate, base_url)
            records.append(record)
    return records


def extract_records(markup: str, base_url: str) -> list[dict[str, object]]:
    root = parse_document(markup)
    records = extract_table_records(root, base_url)
    if not records:
        records = extract_definition_records(root, base_url)
    unique: dict[int, dict[str, object]] = {}
    for record in records:
        unique[int(record["id"])] = record
    return list(unique.values())


def pagination_urls(markup: str, base_url: str) -> list[str]:
    root = parse_document(markup)
    urls = {base_url}
    for link in root.descendants("a"):
        href = link.attrs.get("href", "")
        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        page = parse_qs(parsed.query).get("page", [""])[0]
        if page.isdigit():
            urls.add(absolute)
    return sorted(urls, key=lambda url: int(parse_qs(urlparse(url).query).get("page", ["1"])[0]))


def page_url(base_url: str, page: int) -> str:
    """Change only the page parameter while retaining all active URL filters."""
    parsed = urlparse(base_url)
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if key != "page"
    ]
    query.append(("page", str(page)))
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))




def reported_total(markup: str) -> int | None:
    text = parse_document(markup).text()
    for pattern in (
        r"(?:total|all)\s*[:：]?\s*([\d,]+)\s*(?:characters?|players?|results?)",
        r"([\d,]+)\s*(?:characters?|players?|results?)\s*(?:found|in total)",
    ):
        match = re.search(pattern, text, re.I)
        if match:
            return int(match.group(1).replace(",", ""))
    return None


def browser_markup(page, url: str, timeout_ms: int, attempts: int = 3) -> str:
    """Load one result page in real Chromium and return its rendered HTML."""
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            page.wait_for_function(
                """() => [...document.querySelectorAll('table tr')].some(row =>
                    /name/i.test(row.innerText) && /(?:no\\.|\\bid\\b)/i.test(row.innerText))""",
                timeout=timeout_ms,
            )
            page.wait_for_timeout(500)
            return page.content()
        except Exception as error:
            last_error = error
            if attempt < attempts:
                time.sleep(attempt)
    raise RuntimeError(
        f"The character table did not load at {url}. Re-run with --headed and "
        "complete any verification shown in Chromium. Last error: {last_error}"
    ) from last_error


def scrape(source_url: str, timeout: float, delay: float, headed: bool, profile: Path) -> list[dict[str, object]]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError(
            "Playwright is not installed. Run: py -m pip install -r requirements.txt "
            "and then: py -m playwright install chromium"
        ) from error

    timeout_ms = int(timeout * 1000)
    profile.mkdir(parents=True, exist_ok=True)
    print(f"Start URL: {source_url}")
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(
            str(profile),
            headless=not headed,
            viewport={"width": 1440, "height": 1100},
            locale="en-US",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else context.new_page()
        try:
            first_markup = browser_markup(page, source_url, timeout_ms)
            first_url = page.url
            first_records = extract_records(first_markup, first_url)
            if not first_records:
                raise RuntimeError("No character rows found on page 1; output was not changed.")

            links = pagination_urls(first_markup, first_url)
            final_page = max((page_number(url) for url in links), default=1)
            final_page = max(final_page, *(int(number) for number in re.findall(r"[?&]page=(\d+)", first_markup)), 1)
            total = reported_total(first_markup)
            all_records = {int(record["id"]): record for record in first_records}
            initial_page = page_number(first_url)
            print(
                f"Page {initial_page}/{final_page}: "
                f"{len(first_records)} records ({len(all_records)} unique)"
            )

            for number in range(1, final_page + 1):
                if number == initial_page:
                    continue
                if delay:
                    time.sleep(delay)
                url = page_url(source_url, number)
                markup = browser_markup(page, url, timeout_ms)
                records = extract_records(markup, page.url)
                if not records:
                    raise RuntimeError(f"No character rows found on page {number}; output was not changed.")
                for record in records:
                    identifier = int(record["id"])
                    previous = all_records.get(identifier)
                    if previous and previous["name"] != record["name"]:
                        raise RuntimeError(f"ID {identifier} was associated with multiple names; output was not changed.")
                    all_records[identifier] = record
                print(f"Page {number}/{final_page}: {len(records)} records ({len(all_records)} unique)")
        finally:
            context.close()

    players = [all_records[key] for key in sorted(all_records)]
    missing = [f"{player['id']} ({player['name']})" for player in players if not player["imageUrl"]]
    if missing:
        raise RuntimeError(
            f"Missing same-row portrait URLs for {len(missing)} players: {', '.join(missing[:10])}. "
            "Output was not changed."
        )
    if total is not None and len(players) != total:
        raise RuntimeError(
            f"The site reports {total} results but {len(players)} unique players were extracted; output was not changed."
        )
    return players


def page_number(url: str) -> int:
    value = parse_qs(urlparse(url).query).get("page", ["1"])[0]
    return int(value) if value.isdigit() else 1


def load_players(path: Path) -> list[dict[str, object]]:
    """Load the JSON array assigned in an existing players.js file."""
    if not path.exists():
        return []

    content = path.read_text(encoding="utf-8")
    assignment = re.search(r"globalThis\.INAZUMA_PLAYERS\s*=\s*", content)
    if not assignment:
        raise RuntimeError(
            f"{path} exists but does not assign globalThis.INAZUMA_PLAYERS; "
            "the file was not changed."
        )
    try:
        players, end = json.JSONDecoder().raw_decode(content[assignment.end():])
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"{path} contains invalid player data; the file was not changed."
        ) from error
    if content[assignment.end() + end:].strip().rstrip(";").strip():
        raise RuntimeError(
            f"{path} contains unexpected content after the player array; "
            "the file was not changed."
        )
    if not isinstance(players, list):
        raise RuntimeError(f"{path} does not contain a player array; the file was not changed.")

    unique: dict[int, dict[str, object]] = {}
    for index, player in enumerate(players):
        if not isinstance(player, dict):
            raise RuntimeError(
                f"{path} player entry {index + 1} is not an object; the file was not changed."
            )
        try:
            identifier = int(player["id"])
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError(
                f"{path} player entry {index + 1} has no valid id; the file was not changed."
            ) from error
        normalized = dict(player)
        normalized["id"] = identifier
        if identifier in unique:
            unique[identifier] = merge_player(unique[identifier], normalized)
        else:
            unique[identifier] = normalized
    return [unique[key] for key in sorted(unique)]


def has_information(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return clean_text(value) not in {"", "-", "—"}
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def merge_player(
    existing: dict[str, object],
    extracted: dict[str, object],
) -> dict[str, object]:
    """Merge a player without allowing blank extracted fields to erase data."""
    merged = dict(existing)
    merged["id"] = int(extracted.get("id", existing["id"]))
    for field, value in extracted.items():
        if field == "id":
            continue
        if field == "teams":
            old_teams = existing.get("teams", [])
            old_values = old_teams if isinstance(old_teams, list) else [old_teams]
            new_values = value if isinstance(value, list) else [value]
            teams: list[str] = []
            for team in [*old_values, *new_values]:
                normalized = clean_text(str(team)) if team is not None else ""
                if has_information(normalized) and normalized not in teams:
                    teams.append(normalized)
            merged["teams"] = teams
        elif has_information(value):
            merged[field] = value
    return merged


def merge_players(
    existing: list[dict[str, object]],
    extracted: list[dict[str, object]],
) -> tuple[list[dict[str, object]], int]:
    """Merge datasets by player ID and return the result and duplicate count."""
    merged = {int(player["id"]): dict(player) for player in existing}
    duplicate_count = 0
    for player in extracted:
        identifier = int(player["id"])
        if identifier in merged:
            duplicate_count += 1
            merged[identifier] = merge_player(merged[identifier], player)
        else:
            merged[identifier] = dict(player)
    return [merged[key] for key in sorted(merged)], duplicate_count


def write_players(players: list[dict[str, object]], output: Path, source_url: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(players, ensure_ascii=False, indent=2)
    content = (
        "// Generated by scripts/extract_players.py. Do not edit manually.\n"
        f"// Source: {source_url}\n"
        f"globalThis.INAZUMA_PLAYERS = {payload};\n"
    )
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(output)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        default=SOURCE_URL,
        help="Exact Codex start URL, including any active filters",
    )
    parser.add_argument(
        "--source",
        dest="legacy_source",
        help=argparse.SUPPRESS,
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="JavaScript output path")
    parser.add_argument("--profile", type=Path, default=Path(".playwright-profile"), help="Persistent Chromium profile")
    parser.add_argument("--headed", action="store_true", help="Show Chromium to handle a verification page")
    parser.add_argument("--timeout", type=float, default=60, help="Per-page timeout in seconds")
    parser.add_argument("--delay", type=float, default=0.2, help="Delay between page requests")
    parser.add_argument("--html", type=Path, help="Parse one saved HTML page instead of opening Chromium")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    start_url = args.legacy_source or args.url
    existing_players = load_players(args.output)
    print(f"Existing players count: {len(existing_players)}")
    if args.html:
        print(f"Start URL: {start_url}")
        extracted_players = extract_records(args.html.read_text(encoding="utf-8"), start_url)
        if not extracted_players:
            print("Newly extracted players count: 0")
            print("Duplicate players skipped: 0")
            print(f"Final total players count: {len(existing_players)}")
            raise RuntimeError(
                f"Zero players were found in {args.html}; data/players.js was not changed."
            )
        if any(not player["imageUrl"] for player in extracted_players):
            raise RuntimeError("At least one fixture record has no same-row portrait URL")
    else:
        extracted_players = scrape(start_url, args.timeout, args.delay, args.headed, args.profile)
    if not extracted_players:
        print("Newly extracted players count: 0")
        print("Duplicate players skipped: 0")
        print(f"Final total players count: {len(existing_players)}")
        raise RuntimeError("Zero players were found; data/players.js was not changed.")
    players, duplicate_count = merge_players(existing_players, extracted_players)
    write_players(players, args.output, start_url)
    print(f"Newly extracted players count: {len(extracted_players)}")
    print(f"Duplicate players skipped: {duplicate_count}")
    print(f"Final total players count: {len(players)}")
    print(f"Complete: wrote {len(players)} players to {args.output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Cancelled; data/players.js was not changed.", file=sys.stderr)
        raise SystemExit(130)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
