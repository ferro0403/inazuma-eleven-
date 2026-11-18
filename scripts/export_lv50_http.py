#!/usr/bin/env python3
"""One-shot, read-only extraction of official Zukan level-50 stats.

No application files written, no rating changes. Uses same-row official links
to reconcile public No. to the seven attributes. Missing records stay missing.
"""
from __future__ import annotations
from bs4 import BeautifulSoup
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.parse import urljoin, urlparse, parse_qs
from pathlib import Path
import json
import re
import time

FIELDS=("kick","control","technique","pressure","physical","agility","intelligence")
ROOT="https://zukan.inazuma.jp"
COUNT=5460
PAGES=110
PER_PAGE=50
OUT=Path("export")


def viewer_key(url):
    parsed=urlparse(urljoin(ROOT,url or ""))
    return parse_qs(parsed.query).get("q",[""])[0] if "/chara_model_view/" in parsed.path else ""


def fetch(kind,n):
    uri=f"{ROOT}/en/chara_{'list' if kind=='list' else 'param'}/?page={n}&per_page={PER_PAGE}"
    req=Request(uri,headers={"User-Agent":"Mozilla/5.0 (compatible; InaMosseStats/1.0)","Accept-Language":"en-US,en;q=0.9"})
    for retry in range(4):
        try:
            with urlopen(req,timeout=40) as resp:
                if resp.status!=200: raise RuntimeError("HTTP "+str(resp.status))
                text=resp.read().decode("utf-8","replace")
            if len(text)<10000: raise RuntimeError("Unexpected short HTML")
            return kind,n,text
        except Exception as error:
            print(f"RETRY {kind} {n} {retry}: {str(error)[:130]}",flush=True)
            if retry==3:raise
            time.sleep(1.5*(retry+1))


def list_rows(markup):
    soup=BeautifulSoup(markup,"html.parser")
    rows=None;headers=None;start=0
    for table in soup.find_all("table"):
        trs=table.find_all("tr")
        for i,tr in enumerate(trs):
            cells=tr.find_all(["th","td"],recursive=False)
            keys=[c.get_text(" ",strip=True).casefold() for c in cells]
            if "name" in keys and ("no." in keys or "no" in keys):
                rows=trs
                headers=keys
                start=i+1
                break
        if rows is not None:break
    if rows is None:raise RuntimeError("No public ID table found")
    index=headers.index("no.") if "no." in headers else headers.index("no")
    name_index=headers.index("name")
    output=[]
    for tr in rows[start:]:
        cells=tr.find_all(["th","td"],recursive=False)
        if len(cells)<=max(index,name_index):continue
        number=cells[index].get_text(" ",strip=True)
        if not number.isdigit():continue
        viewer_links={urljoin(ROOT,a.get("href","")) for a in tr.find_all("a",href=True) if "/chara_model_view/" in a["href"]}
        param_links={urljoin(ROOT,a.get("href","")) for a in tr.find_all("a",href=True) if "/chara_param/" in a["href"] and "q=" in a["href"]}
        if len(viewer_links)!=1:raise RuntimeError(f"No unique viewer for {number}: {viewer_links}")
        portrait=cells[name_index].select_one(".nameBox img[alt]")
        name=portrait.get("alt","").strip() if portrait else cells[name_index].get_text(" ",strip=True)[:100]
        output.append({"id":int(number),"key":viewer_key(next(iter(viewer_links))),
                       "name":name,
                       "param":next(iter(param_links)) if len(param_links)==1 else None})
    return output


def param_rows(markup):
    soup=BeautifulSoup(markup,"html.parser")
    output=[]
    for ul in soup.select("ul.param"):
        parent=ul
        link=None
        while parent is not None:
            links={a.get("href","") for a in parent.find_all("a",href=True) if "/chara_model_view/" in a["href"]}
            if len(parent.select("ul.param"))==1 and len(links)==1:
                link=next(iter(links))
                break
            parent=parent.parent
        if not link:raise RuntimeError("Missing unique Character Viewer on attribute card")
        values={}
        for dl in ul.find_all("dl"):
            dt=dl.find("dt")
            if dt is None:continue
            key=dt.get_text(" ",strip=True).casefold()
            if key not in FIELDS:continue
            td=dl.select_one("table td")
            raw=td.get_text(" ",strip=True) if td else ""
            values[key]=int(raw) if raw.isdigit() else None
        output.append((viewer_key(link),[values.get(k) for k in FIELDS]))
    return output


def main():
    # Modest concurrency: 3 requests max, no browser, no images.
    all_rows={}
    all_stats={}
    for kind in ("list","param"):
        with ThreadPoolExecutor(max_workers=3) as pool:
            jobs={pool.submit(fetch,kind,n):n for n in range(1,PAGES+1)}
            for task in as_completed(jobs):
                _, n, markup=task.result()
                rows=list_rows(markup) if kind=="list" else param_rows(markup)
                expected=PER_PAGE if n<PAGES else COUNT-PER_PAGE*(PAGES-1)-(1 if kind=="param" else 0)
                if len(rows)!=expected:
                    raise RuntimeError(f"{kind} page {n}: expected {expected}, got {len(rows)}")
                if kind=="list":
                    for row in rows:
                        pid=row["id"]
                        if pid in all_rows and all_rows[pid]!=row:
                            raise RuntimeError(f"Conflicting public ID {pid}")
                        all_rows[pid]=row
                else:
                    for key,nums in rows:
                        if not key:raise RuntimeError(f"Missing viewer key on param page {n}")
                        if key in all_stats and all_stats[key]!=nums:
                            raise RuntimeError(f"Conflicting level-50 stats key {key}")
                        all_stats[key]=nums
                if n==1 or n==PAGES or n%10==0:
                    print(f"SCRAPE {kind} page {n}/{PAGES} IDs={len(all_rows)} stat_keys={len(all_stats)}",flush=True)

    if len(all_rows)!=COUNT:
        raise RuntimeError(f"Public list incomplete: {len(all_rows)} vs {COUNT}")
    if len(all_stats)<5400:
        raise RuntimeError(f"Attribute list incomplete: only {len(all_stats)} verified viewers")

    available={}
    missing=[]
    for pid,row in sorted(all_rows.items()):
        nums=all_stats.get(row["key"])
        if nums is not None and len(nums)==7 and all(isinstance(v,int) and v>=0 for v in nums):
            available[str(pid)]=nums
        else:
            missing.append({"id":pid,"name":row["name"],"reason":"no verified official attribute card",
                            "stats":nums if nums else [None]*7,
                            "hasParamLink":bool(row["param"])})
    # Critical regression anchor.
    if available.get("1")!=[90,97,91,98,105,111,97]:
        raise RuntimeError(f"Mark Evans anchor mismatch: {available.get('1')}")
    if len(available)+len(missing)!=COUNT:
        raise RuntimeError("Not all public IDs accounted for")

    groups=defaultdict(list)
    for pid,nums in available.items():
        groups[tuple(nums)].append(int(pid))
    duplicates=[{"stats":list(k),"ids":sorted(v),"count":len(v)} for k,v in groups.items() if len(v)>1]
    duplicates.sort(key=lambda item:(-item["count"],item["ids"][0]))
    report={
      "officialCatalog":COUNT,
      "statsAvailable":len(available),
      "statsUnavailable":len(missing),
      "unavailable":missing,
      "distinctStatProfiles":len(groups),
      "identicalStatGroups":len(duplicates),
      "playersWithIdenticalStats":sum(x["count"] for x in duplicates),
      "extraCopiesBeyondFirst":sum(x["count"]-1 for x in duplicates),
      "identicalPairs":sum(x["count"]*(x["count"]-1)//2 for x in duplicates),
      "groups":duplicates,
    }
    payload={"version":1,"level":50,
      "source":{"list":f"{ROOT}/en/chara_list/","stats":f"{ROOT}/en/chara_param/",
                "retrievedAt":datetime.now(timezone.utc).isoformat()},
      "fields":list(FIELDS),
      "byPlayerId":available,
      "unavailable":missing,
    }
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/"official-lv50-statistics.json").write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+"\n",encoding="utf-8")
    (OUT/"official-lv50-duplicate-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("LV50_FINISHED",json.dumps({k:v for k,v in report.items() if k not in ("groups","unavailable")},ensure_ascii=False),flush=True)
    print("UNAVAILABLE",json.dumps(missing[:15],ensure_ascii=False),flush=True)
    print("TOP_DUPLICATE_GROUPS",json.dumps(duplicates[:6],ensure_ascii=False),flush=True)

if __name__=="__main__":
    main()
