#!/usr/bin/env python3
from urllib.request import Request,urlopen
from html.parser import HTMLParser
import re,time
for url in ('https://zukan.inazuma.jp/en/chara_param/?page=1&per_page=50',
            'https://zukan.inazuma.jp/en/chara_list/?page=1&per_page=50'):
    req=Request(url,headers={'User-Agent':'Mozilla/5.0','Accept-Language':'en-US,en;q=0.9'})
    try:
        with urlopen(req,timeout=25) as response:
            t=response.read().decode('utf-8','replace')
            print('HTTP_PROBE',url,'status',response.status,'bytes',len(t),
              'param_ul',len(re.findall(r'<ul[^>]+class=["\\']param["\\']',t)),
              'model_view_links',t.count('/chara_model_view/?q='),
              'mark',('Mark Evans' in t),'kick',('Kick' in t),'no',('No.' in t),flush=True)
    except Exception as ex:
        print('ERROR',url,repr(ex),flush=True)
