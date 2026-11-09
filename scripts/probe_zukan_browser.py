#!/usr/bin/env python3
"""Read-only network and image URL smoke test against the official English Zukan."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_players as scraper

def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(locale="en-US")
        try:
            url = scraper.SOURCE_URL
            markup = scraper.browser_markup(page, url, 35000, attempts=2)
            players = scraper.extract_records(markup, page.url)
            print(json.dumps({"url": page.url, "listingCount": len(players),
                              "firstId": players[0]["id"] if players else None,
                              "portraitsFound": sum(bool(p.get("imageUrl")) for p in players),
                              "pages": len(scraper.pagination_urls(markup, page.url))}), flush=True)
            if len(players) < 10:
                return 2
            # Character Viewer is a distinct page: record whether the official
            # site exposes static front-fullbody artwork without guessing URLs.
            root = scraper.parse_document(markup)
            details = []
            for a in root.descendants("a"):
                target = a.attrs.get("href", "")
                if "/chara_param/" in target:
                    from urllib.parse import urljoin
                    details.append(urljoin(page.url, target))
            print("Detail links on page:", len(details), flush=True)
            if not details:
                return 3
            page.goto(details[0], wait_until="domcontentloaded", timeout=35000)
            root = scraper.parse_document(page.content())
            viewers = []
            for a in root.descendants("a"):
                target = a.attrs.get("href", "")
                if "/chara_model_view/" in target:
                    from urllib.parse import urljoin
                    viewers.append(urljoin(page.url, target))
            print("Viewer links on detail:", len(viewers), flush=True)
            if not viewers:
                return 4
            page.goto(viewers[0], wait_until="domcontentloaded", timeout=35000)
            page.wait_for_timeout(800)
            try:
                page.get_by_text("Full", exact=True).first.click(timeout=2000)
                page.wait_for_timeout(800)
            except Exception:
                pass
            urls = page.evaluate("() => performance.getEntriesByType('resource').map(x => x.name)")
            import re
            candidates = sorted(set(re.findall(r"https?://[^\\s\\\"'<>]+?_r0_fullbody\\.webp", page.content() + "\\n".join(urls))))
            print(json.dumps({"frontFullbodyFound": bool(candidates), "sample": candidates[:2],
                    "viewerUrl": page.url,
                    "cdnResources": [u for u in urls if "cloudfront" in u][:25],
                    "imageUrls": page.locator("img").evaluate_all("(imgs) => imgs.slice(0,50).map(i => ({src:i.src, cls:i.className}))"),
                    "resourceCount": len(urls)}, indent=2), flush=True)
            return 0
        finally:
            browser.close()

if __name__ == "__main__":
    raise SystemExit(main())
