#!/usr/bin/env python3
"""Read-only probe of public Zukan attributes and same-row public ID links."""
import json
from playwright.sync_api import sync_playwright

URLS=[
"https://zukan.inazuma.jp/en/chara_param/?per_page=50",
"https://zukan.inazuma.jp/en/chara_param/?page=2&per_page=50",
"https://zukan.inazuma.jp/en/chara_list/?per_page=50",
"https://zukan.inazuma.jp/en/chara_param/?q=hN2ZlpOLmo2gnJeejZ6glpugjIuN3cWk3ZzPzs_Pz8_Oz92igg%3D%3D",
]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(locale="en-US")
    for url in URLS:
        try:
            page.goto(url,wait_until="domcontentloaded",timeout=45000)
            page.wait_for_timeout(700)
            out=page.evaluate("""() => {
                const root=document.body;
                const els=[...document.querySelectorAll('*')].filter(el => {
                    if (!el.children.length) return false;
                    const s=el.innerText||'';
                    if (!(s.includes('Kick')&&s.includes('Control')&&s.includes('Technique')&&s.includes('Pressure')&&s.includes('Physical')&&s.includes('Agility')&&s.includes('Intelligence')))return false;
                    return ![...el.children].some(c=>{
                        const t=c.innerText||'';
                        return t.includes('Kick')&&t.includes('Control')&&t.includes('Technique')&&t.includes('Pressure')&&t.includes('Physical')&&t.includes('Agility')&&t.includes('Intelligence');
                    })
                });
                const candidates=els.slice(0,5).map(el=>({tag:el.tagName,cls:el.className,
                    text:(el.innerText||'').slice(0,900),
                    html:el.outerHTML.slice(0,7200),
                    links:[...el.querySelectorAll('a')].map(a=>a.getAttribute('href')).slice(0,6)}));
                const groups={};
                for(const el of els)groups[el.tagName+'.'+el.className]=(groups[el.tagName+'.'+el.className]||0)+1;
                const allLinks=[...document.querySelectorAll('a[href*="chara_param"], a[href*="chara_model_view"]')].slice(0,6)
                  .map(a=>({href:a.getAttribute('href'),parent:a.parentElement?.parentElement?.outerHTML.slice(0,700)}));
                return {title:document.title,loc:location.href,bodyText:root.innerText.slice(0,350),
                    candidateCount:els.length,groups,candidates,allLinks,
                    items:document.querySelectorAll('ul.itemListBox >li').length,
                    resultsCount:(root.innerText.match(/Search Results:[^\\n]*\\n[^\\n]*/)||[])[0],
                    pages:[...document.querySelectorAll('a[href*="page="]')].slice(0,10).map(a=>a.href)};
            }""")
            print("PROBE",json.dumps(out,ensure_ascii=False),flush=True)
        except Exception as e:
            print("ERROR",str(e),flush=True)
    browser.close()
