#!/usr/bin/env python3
"""Browser smoke check for downloaded local ZIP and HTTP serving of InaCodex."""
import json
import threading
import time
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

def main():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    cases = [("file", (ROOT/"index.html").as_uri()),
             ("http", f"http://127.0.0.1:{server.server_port}/index.html")]
    bad = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            for mode, url in cases:
                ctx = browser.new_context()
                # The page must render without image downloads; still load all local scripts.
                ctx.route("**/*", lambda route: route.abort() if route.request.resource_type in ("image", "font") else route.continue_())
                page = ctx.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)[:500]))
                page.on("console", lambda m: errors.append("CONSOLE "+m.text[:280]) if m.type=="error" and len(errors)<12 else None)
                start=time.monotonic()
                try:
                    response=page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_function("() => Number((document.querySelector('#total-count')?.textContent||'0').replace(/[^0-9]/g,'')) >= 5000 && document.querySelectorAll('#player-grid .player-card').length > 0",timeout=50000)
                    options=page.locator("#game-filter option").all_text_contents()
                    if len(options)<2 or options[0]!="All games":
                        raise AssertionError("Game filter missing or empty: "+str(options[:5]))
                    selected=page.locator("#game-filter").locator("option").nth(1).get_attribute("value")
                    page.locator("#game-filter").select_option(selected)
                    matching_count=page.locator("#result-count").inner_text()
                    visible=page.locator("#player-grid .player-card").count()
                    if not visible or visible>48 or "5,475" in matching_count:
                        raise AssertionError("Game filter didn't narrow matches: "+matching_count)
                    page.locator("#reset-filters").click()
                    if page.locator("#game-filter").input_value()!="":
                        raise AssertionError("Reset didn't clear game filter")
                    print("GAME_FILTER",json.dumps({"mode":mode,"options":len(options),"selected":selected,"matching":matching_count}),flush=True)
                    page.locator('[data-view="teams"]').click()
                    team_count=page.locator("#team-count").inner_text(timeout=10000)
                    teams_rendered=page.locator("#team-grid").locator("*").count()
                    page.locator('[data-view="ratings"]').click()
                    page.wait_for_timeout(2000)
                    report={"mode":mode,"ok":True,"httpStatus":response.status if response else None,
                            "players":page.locator("#total-count").inner_text(),
                            "renderedCards":page.locator("#player-grid .player-card").count(),
                            "teamsLabel":team_count,"teamElements":teams_rendered,
                            "ratingsPanel":page.locator("#ratings-view").is_visible(),
                            "elapsedSeconds":round(time.monotonic()-start,2),"errors":errors[:12]}
                except Exception as exc:
                    report={"mode":mode,"ok":False,"error":str(exc)[:800],
                            "players":page.locator("#total-count").inner_text() if page.locator("#total-count").count() else None,
                            "bodyText":page.locator("body").inner_text()[:240] if page.locator("body").count() else None,
                            "elapsedSeconds":round(time.monotonic()-start,2),"errors":errors[:12]}
                    bad.append(mode)
                print("BROWSER_SMOKE",json.dumps(report,ensure_ascii=False),flush=True)
                ctx.close()
        finally:
            browser.close()
            server.shutdown()
    return 1 if bad else 0

if __name__=="__main__":
    raise SystemExit(main())
