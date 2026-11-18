#!/usr/bin/env python3
"""Read-only, complete official Zukan Lv50 export; never changes an app or main.

Join by the unique Character Viewer q from the SAME official player entry.
No fuzzy names and no guessing missing statistics.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

URL_LIST = "https://zukan.inazuma.jp/en/chara_list/"
URL_STATS = "https://zukan.inazuma.jp/en/chara_param/"
FIELDS = ("kick", "control", "technique", "pressure", "physical", "agility", "intelligence")
OUTPUT = Path("export/official-lv50-statistics.json")
REPORT = Path("export/official-lv50-duplicate-report.json")
PAGE_SIZE = 50
TIMEOUT_MS = 45000


def viewer_key(href: str) -> str:
    if not href:
        return ""
    uri = urlparse(href)
    if "/chara_model_view/" not in uri.path:
        return ""
    return parse_qs(uri.query).get("q", [""])[0]


def extract_page(page, kind: str, number: int) -> list[dict]:
    url = (URL_LIST if kind == "list" else URL_STATS) + f"?page={number}&per_page={PAGE_SIZE}"
    for attempt in range(1, 4):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            if kind == "list":
                page.locator("table tr").first.wait_for(timeout=TIMEOUT_MS)
                raw = page.evaluate("""() => {
                   const t=[...document.querySelectorAll('table')].find(t =>
                      [...t.querySelectorAll('tr')].some(r => {
                        const h=[...r.children].map(c=>c.innerText.trim().toLowerCase());
                        return h.includes('name')&&(h.includes('no.')||h.includes('no'));
                      }));
                   if (!t) return {error:'no ID/name table'};
                   const trs=[...t.querySelectorAll('tr')];
                   let cols=null, start=0;
                   trs.some((tr,i)=>{
                       const c=[...tr.children].map(e=>e.innerText.trim().toLowerCase());
                       if(c.includes('name')&&(c.includes('no.')||c.includes('no'))){
                           cols=c;start=i+1;return true;
                       }return false;
                   });
                   const noIndex=cols.indexOf('no.')>=0?cols.indexOf('no.'):cols.indexOf('no');
                   const result=[];
                   for(const tr of trs.slice(start)){
                     const cells=[...tr.children].filter(e=>e.tagName==='TH'||e.tagName==='TD');
                     const id=(cells[noIndex]?.innerText||'').trim();
                     if(!/^\\d+$/.test(id))continue;
                     const v=[...tr.querySelectorAll('a[href*="/chara_model_view/"]')].map(a=>a.href);
                     const u=[...new Set(v)];
                     const p=[...new Set([...tr.querySelectorAll('a[href*="/chara_param/?q="]')].map(a=>a.href))];
                     result.push({id:Number(id),viewer:u.length===1?u[0]:'',viewers:u.length,
                                  param:p.length===1?p[0]:'',params:p.length,
                                  name:tr.querySelector('.nameBox img[alt]')?.alt?.trim() || cells[cols.indexOf('name')]?.innerText.trim().slice(0,150)||''});
                   }
                   return {rows:result};
                }""")
                if "error" in raw:
                    raise RuntimeError(raw["error"])
                rows = raw["rows"]
            else:
                page.locator("ul.param").first.wait_for(timeout=TIMEOUT_MS)
                rows = page.evaluate("""() => {
                    const labels=['kick','control','technique','pressure','physical','agility','intelligence'];
                    return [...document.querySelectorAll('ul.param')].map(ul => {
                        let p=ul, viewer=[];
                        for(let i=0;i<9&&p;i++,p=p.parentElement) {
                            const params=p.querySelectorAll('ul.param');
                            const links=[...p.querySelectorAll('a[href*="/chara_model_view/"]')].map(a=>a.href);
                            if(params.length===1 && links.length===1){viewer=links;break;}
                        }
                        const stats={};
                        for (const dl of ul.querySelectorAll('dl')) {
                            const key=(dl.querySelector('dt')?.textContent||'').trim().toLowerCase();
                            if (!labels.includes(key))continue;
                            const val=(dl.querySelector('table td')?.textContent||'').trim();
                            stats[key]=/^\\d+$/.test(val)?Number(val):null;
                        }
                        return {viewer:viewer[0]||'',viewers:viewer.length,
                            stats:labels.map(k=>stats[k]===undefined?null:stats[k])};
                    });
                }""")
            if len(rows) != PAGE_SIZE and not (number == 110 and 0 < len(rows) <= PAGE_SIZE):
                raise RuntimeError(f"Unexpected {kind} page {number} row count {len(rows)}")
            return rows
        except Exception as err:
            print(f"RETRY {kind} page {number} attempt {attempt} error {err!s:.240}",flush=True)
            if attempt == 3:
                raise
            time.sleep(1.2 * attempt)


def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        context=browser.new_context(locale="en-US")
        page=context.new_page()
        index = {}
        stats = {}
        try:
            for n in range(1,111):
                rows=extract_page(page,"list",n)
                for row in rows:
                    pid=row["id"]
                    key=viewer_key(row["viewer"])
                    if not key or row["viewers"]!=1:
                        raise RuntimeError(f"Missing/ambiguous viewer link for public ID {pid}: {row!r}")
                    if pid in index and index[pid]["key"]!=key:
                        raise RuntimeError(f"ID {pid} changed viewer")
                    index[pid]={"key":key,"name":row["name"],"param":row["param"]}
                if n==1 or n%10==0 or n==110:
                    print(f"OFFICIAL_ID_LIST {n}/110 {len(index)} IDs",flush=True)
            if len(index) != 5460:
                raise RuntimeError(f"Official public ID list unexpectedly has {len(index)} entries (expected 5460)")
            for n in range(1,111):
                rows=extract_page(page,"stats",n)
                for row in rows:
                    key=viewer_key(row["viewer"])
                    if not key or row["viewers"]!=1:
                        raise RuntimeError(f"Missing/ambiguous viewer for stats page {n}: {row!r}")
                    if key in stats and stats[key]!=row["stats"]:
                        raise RuntimeError(f"Conflicting official stats for viewer {key}")
                    stats[key]=row["stats"]
                if n==1 or n%10==0 or n==110:
                    print(f"OFFICIAL_STATS {n}/110 {len(stats)} viewers",flush=True)
        finally:
            browser.close()

    if len(stats) < 5400:
        raise RuntimeError(f"Attribute pages unexpectedly have only {len(stats)} unique viewers")
    print(f"ATTRIBUTE_VIEWERS unique={len(stats)}; official_ids={len(index)} (shared viewers allowed when stat values agree)",flush=True)
    by_id={}
    incomplete=[]
    not_found=[]
    for pid, info in index.items():
        numbers=stats.get(info["key"])
        if numbers is None:
            not_found.append({"id":pid,"name":info["name"],"reason":"viewer_not_found"})
        elif all(isinstance(v,int) and v>=0 for v in numbers):
            by_id[str(pid)]=numbers
        else:
            incomplete.append({"id":pid,"name":info["name"],"stats":numbers})
    # Exception handling: an official ID may be missing from global Attribute Search
    # despite having its own one-character Attribute link in the Character list.
    # Verify THAT exact same-row URL and never match by name alone.
    if not_found:
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True)
            page=browser.new_page(locale="en-US")
            try:
                still_missing=[]
                for missing in not_found:
                    pid=missing["id"]
                    direct=index[pid]["param"]
                    uri=urlparse(direct)
                    if (uri.hostname!="zukan.inazuma.jp"
                        or "/chara_param/" not in uri.path or not parse_qs(uri.query).get("q")):
                        still_missing.append(missing)
                        continue
                    page.goto(direct,wait_until="domcontentloaded",timeout=TIMEOUT_MS)
                    page.locator("ul.param").first.wait_for(timeout=TIMEOUT_MS)
                    result=page.evaluate("""() => {
                        const els=[...document.querySelectorAll('ul.param')];
                        if(els.length!==1)return {count:els.length};
                        const keys=['kick','control','technique','pressure','physical','agility','intelligence'];
                        const stats={};
                        for(const dl of els[0].querySelectorAll('dl')){
                            const key=(dl.querySelector('dt')?.textContent||'').trim().toLowerCase();
                            const value=(dl.querySelector('table td')?.textContent||'').trim();
                            if(keys.includes(key)) stats[key]=/^\\d+$/.test(value)?Number(value):null;
                        }
                        let parent=els[0],label='';
                        for(let i=0;i<8&&parent;i++,parent=parent.parentElement) {
                            if(parent.querySelectorAll('ul.param').length===1){
                                const portrait=parent.querySelector('img[alt]');
                                if(portrait&&portrait.alt.trim()){label=portrait.alt.trim();break;}
                            }
                        }
                        return {count:els.length,stats:keys.map(k=>stats[k]??null),name:label};
                    }""")
                    print("DIRECT_ATTRIBUTE_RECHECK",json.dumps({"id":pid,**result},ensure_ascii=False),flush=True)
                    matches=(result.get("name","").strip().casefold()==index[pid]["name"].strip().casefold())
                    values=result.get("stats",[])
                    if result.get("count")==1 and matches and len(values)==7 and all(isinstance(v,int) and v>=0 for v in values):
                        by_id[str(pid)]=values
                    elif result.get("count")==1 and matches and len(values)==7:
                        incomplete.append({"id":pid,"name":index[pid]["name"],"stats":values})
                    else:
                        still_missing.append(missing)
                not_found=still_missing
            finally:
                browser.close()
    if not_found:
        for missing in not_found:
            incomplete.append({"id":missing["id"],"name":missing["name"],
                               "stats":[None]*7,
                               "reason":"official_character_row_has_no_unique_attribute_link"})
        print("OFFICIAL_ATTRIBUTE_UNAVAILABLE",json.dumps(not_found,ensure_ascii=False),flush=True)
    if len(by_id)+len(incomplete)!=5460:
        raise RuntimeError("Unreconciled public player IDs")

    by_group=defaultdict(list)
    for identifier, numbers in by_id.items():
        by_group[tuple(numbers)].append(int(identifier))
    duplicates=[{"stats":list(signature),"ids":sorted(ids),"count":len(ids)}
                for signature, ids in by_group.items() if len(ids)>1]
    duplicates.sort(key=lambda x:(-x["count"],x["ids"][0]))
    report={
        "officialCatalog":5460,
        "statsAvailable":len(by_id),
        "statsUnavailable":len(incomplete),
        "unavailable":incomplete,
        "distinctStatProfiles":len(by_group),
        "identicalStatGroups":len(duplicates),
        "playersWithIdenticalStats":sum(g["count"] for g in duplicates),
        "extraCopiesBeyondFirst":sum(g["count"]-1 for g in duplicates),
        "identicalPairs":sum(g["count"]*(g["count"]-1)//2 for g in duplicates),
        "groups":duplicates
    }
    payload={
        "version":1,"level":50,
        "source":{"list":URL_LIST,"stats":URL_STATS,"retrievedAt":datetime.now(timezone.utc).isoformat()},
        "fields":list(FIELDS),"byPlayerId":dict(sorted(by_id.items(),key=lambda item:int(item[0]))),
        "unavailable":incomplete
    }
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding="utf-8")
    REPORT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding="utf-8")
    print("FINAL_REPORT",json.dumps({k:v for k,v in report.items() if k not in ("groups","unavailable")},ensure_ascii=False),flush=True)
    print("SAMPLES",json.dumps({k:by_id.get(k) for k in ("1","2","3","4","5000","5450")}),flush=True)
    print("TOP_DUPLICATE_GROUPS",json.dumps(duplicates[:8]),flush=True)


if __name__=="__main__":
    main()
