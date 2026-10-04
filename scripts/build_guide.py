"""片町ガイド（docs/katamachi/index.html）のお店一覧を、いまの掲載店から作り直す。

    python scripts/build_guide.py

読み物の部分はページに手で書いてあり、ここでは目印（<!--shops:start--> と
<!--shops:end-->）のあいだの一覧だけを書き換える。お店は Supabase の
public_shops ビュー（公開項目だけ）から読み、読めないときは docs/data/shops.json を使う。
sitemap.xml の片町ガイドの更新日もここで直す。
"""
from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from html import escape as h
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "docs" / "katamachi" / "index.html"
SITEMAP = ROOT / "docs" / "sitemap.xml"
CONFIG = ROOT / "docs" / "config.js"
FALLBACK = ROOT / "docs" / "data" / "shops.json"
MARK = ("<!--shops:start-->", "<!--shops:end-->")
GUIDE_URL = "https://ekimae.fukui-fukui.com/katamachi/"
# 一覧に出す順（ジャンル）
GENRES = ["スナック・ラウンジ", "バー"]


def load_shops() -> list[dict]:
    cfg = CONFIG.read_text(encoding="utf-8")
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg)
    key = re.search(r'supabaseAnonKey:\s*"([^"]+)"', cfg)
    if url and key and url.group(1):
        req = urllib.request.Request(
            f"{url.group(1)}/rest/v1/public_shops?select=slug,name,kana,zone,genre,instagram,category&category=eq.night&limit=2000",
            headers={"apikey": key.group(1), "Authorization": f"Bearer {key.group(1)}"})
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                return json.load(res)
        except OSError as e:
            print(f"::warning::Supabase から読めませんでした（{e}）。shops.json を使います。")
    return json.loads(FALLBACK.read_text(encoding="utf-8"))


def render(shops: list[dict]) -> str:
    kata = [s for s in shops if s.get("zone") == "katamachi" and s.get("category", "night") == "night"]
    out = [MARK[0], f"<p>ふくいエキマエに載っている片町のお店は、いま{len(kata)}軒です。店名を押すと、お店のページが開きます。</p>"]
    for g in GENRES:
        its = sorted((s for s in kata if s.get("genre") == g), key=lambda s: s.get("kana") or s["name"])
        if not its:
            continue
        out.append(f"<h3>{h(g)}（{len(its)}軒）</h3><ul class=\"shops\">")
        for s in its:
            ig = s.get("instagram")
            ig_html = f' <small><a href="https://www.instagram.com/{h(ig)}/" rel="noopener" target="_blank">Instagram</a></small>' if ig else ""
            out.append(f'<li><a href="../#/shop/{h(s["slug"])}">{h(s["name"])}</a>{ig_html}</li>')
        out.append("</ul>")
    out.append(MARK[1])
    return "".join(out)


def main() -> int:
    shops = load_shops()
    page = PAGE.read_text(encoding="utf-8")
    a, b = page.find(MARK[0]), page.find(MARK[1])
    if a < 0 or b < 0:
        print("::error::片町ガイドに一覧の目印がありません。")
        return 1
    new = page[:a] + render(shops) + page[b + len(MARK[1]):]
    if new != page:
        PAGE.write_text(new, encoding="utf-8")
        today = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
        sm = SITEMAP.read_text(encoding="utf-8")
        sm = re.sub(r"(<loc>" + re.escape(GUIDE_URL) + r"</loc>)(<lastmod>[^<]*</lastmod>)?", rf"\1<lastmod>{today}</lastmod>", sm)
        SITEMAP.write_text(sm, encoding="utf-8")
    print(f"片町ガイド：{sum(1 for s in shops if s.get('zone') == 'katamachi')} 軒")
    return 0


if __name__ == "__main__":
    sys.exit(main())
