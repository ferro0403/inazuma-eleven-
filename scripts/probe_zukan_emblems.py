#!/usr/bin/env python3
"""Read-only browser probe for official emblem list card structure."""
from playwright.sync_api import sync_playwright
import json
URL="https://zukan.inazuma.jp/en/item/emblem/"
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(locale="en-US")
    page.goto(URL, wait_until="domcontentloaded",timeout=45000)
    page.wait_for_timeout(700)
    result=page.evaluate("""() => {
       let targets=[...document.querySelectorAll('img')].filter(e=>/raimon|royal academy|occult/i.test((e.alt||'')+' '+(e.closest('li')?.innerText||''))).slice(0,8);
       return {title:document.title,url:location.href,firstImages:targets.map(img=>({
         src:img.currentSrc||img.src,alt:img.alt,
         outer:img.parentElement?.parentElement?.outerHTML.slice(0,2400),
       })),listContainers:[...document.querySelectorAll('ul,table,section')].map(e=>({tag:e.tagName,cls:e.className,count:e.querySelectorAll('img').length})).filter(e=>e.count>=10).slice(0,15),
       pagination:[...document.querySelectorAll('a[href*="page="]')].map(a=>a.href).slice(0,12)
       };
    }""")
    print("EMBLEM_PROBE",json.dumps(result,ensure_ascii=False),flush=True)
    browser.close()
