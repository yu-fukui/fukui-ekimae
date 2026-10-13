"""お店ごとの本物のページ（docs/shop/<slug>/index.html）とサイトマップを作る。

代表 10/13「進めて」：お店のページを検索に出すため。
- 中身は公開ビュー（public_shops）からだけ作る。非表示のお店はビューに来ないので、ページも作らない（前にあれば消す）
- 無料／有料で出す項目の決まりは、ビューとサイトの表示（docs/app.js の renderDetail）に合わせる
- Google の口コミ・評価はページに書かない（開いたあと app.js が読み込んで表示する）
- 見た目はトップ（docs/index.html）と同じ。開いたあとは app.js が同じお店を描き直す

  python scripts/build_shop_pages.py            # Supabase から読む
  python scripts/build_shop_pages.py rows.json  # 手元の JSON から（試し用）
"""
import datetime
import html
import json
import pathlib
import re
import shutil
import sys
import urllib.parse
import urllib.request

DOCS = pathlib.Path("docs")
SHOP_DIR = DOCS / "shop"
SITE = "https://ekimae.fukui-fukui.com"
ZONES = {"ekimae": "駅前", "katamachi": "片町"}
ZONE_LONG = {"ekimae": "福井駅前", "katamachi": "片町"}
SLUG_OK = re.compile(r"^[A-Za-z0-9_-]+$")
LINK_LABEL = {"reserve": "予約", "menu": "メニュー", "web": "公式サイト", "sns": "SNS", "other": "リンク"}

e = lambda v: html.escape(str(v), quote=True)


def config() -> dict:
    js = (DOCS / "config.js").read_text()
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', js).group(1)
    key = re.search(r'supabaseAnonKey:\s*"([^"]+)"', js).group(1)
    return {"url": url, "key": key}


def load() -> list:
    if len(sys.argv) > 1:
        return json.loads(pathlib.Path(sys.argv[1]).read_text())
    cfg, rows, size = config(), [], 1000
    for start in range(0, 100000, size):
        req = urllib.request.Request(
            f"{cfg['url']}/rest/v1/public_shops?select=*&order=slug&offset={start}&limit={size}",
            headers={"apikey": cfg["key"], "Authorization": f"Bearer {cfg['key']}"})
        page = json.load(urllib.request.urlopen(req, timeout=60))
        rows += page
        if len(page) < size:
            break
    if len(rows) < 100:
        sys.exit(f"お店が {len(rows)} 件しか読めませんでした。ページを消しすぎないよう、ここで止めます")
    return rows


def photo_url(p, base: str) -> str:
    if isinstance(p, dict):
        return p.get("url") or photo_url(p.get("path", ""), base)
    return f"{base}/storage/v1/object/public/photos/" + "/".join(urllib.parse.quote(x) for x in str(p).split("/"))


def opened_label(s: dict) -> str:
    if not s.get("opened_on"):
        return ""
    y, m, d = (int(x) for x in str(s["opened_on"])[:10].split("-"))
    days = (datetime.date.today() - datetime.date(y, m, d)).days
    return f"{y}年{m}月{d}日オープン" if 0 <= days <= 365 else ""


def area(s: dict) -> str:
    return ZONES.get(s.get("zone"), "") + (f"・{s['town']}" if s.get("town") else "")


def info_rows(s: dict) -> list:
    rows = [("エリア", area(s)), ("ジャンル", s.get("genre"))]
    if opened_label(s):
        rows.append(("オープン", opened_label(s).replace("オープン", "")))
    if s.get("is_paid") and s.get("hours"):
        rows.append(("営業時間", s["hours"]))
    for k, f in [("定休日", "holiday"), ("ラストオーダー", "last_order"), ("電話", "tel"), ("住所", "address"), ("アクセス", "access"),
                 ("席数", "seats"), ("コース", "course"), ("ランチ", "lunch"), ("予算（ランチ）", "budget_lunch"), ("予算（ディナー）", "budget_dinner"),
                 ("個室・貸切", "private_room"), ("予約", "reservation"), ("喫煙", "smoking"), ("支払い", "payment"),
                 ("おひとり様", "solo_ok"), ("お子さま連れ", "kids_ok"), ("テイクアウト", "takeout")]:
        rows.append((k, s.get(f)))
    return [(k, v) for k, v in rows if v and str(v).strip()]


def link_list(items: list) -> str:
    return "".join(f'<li><a href="/shop/{e(x["slug"])}/">{e(x["name"])}</a><small>（{e(x.get("genre") or "")}・{e(area(x))}）</small></li>' for x in items)


def detail(s: dict, shops: list, base: str) -> str:
    photos = s.get("photos") or []
    links = (s.get("links") or []) if s.get("is_paid") else []
    zone_name = ZONE_LONG.get(s.get("zone"), "")
    near = sorted([x for x in shops if x["slug"] != s["slug"] and x.get("category") == s.get("category")
                   and x.get("zone") == s.get("zone") and x.get("genre") == s.get("genre")],
                  key=lambda x: (not x.get("is_paid"), x.get("kana") or x["name"]))[:8]
    town = sorted([x for x in shops if x["slug"] != s["slug"] and s.get("town") and x.get("town") == s.get("town")
                   and x.get("category") == s.get("category") and x not in near],
                  key=lambda x: (not x.get("is_paid"), x.get("kana") or x["name"]))[:12]
    acts = []
    if s.get("tel"):
        acts.append(f'<a class="d-btn tel" href="tel:{e(re.sub(r"[^0-9+]", "", s["tel"]))}"><span><b>電話する</b><small>{e(s["tel"])}</small></span></a>')
    if s.get("instagram"):
        acts.append(f'<a class="d-btn ig" href="https://www.instagram.com/{e(urllib.parse.quote(s["instagram"]))}/" target="_blank" rel="noopener"><span><b>Instagram</b><small>@{e(s["instagram"])}</small></span></a>')
    if s.get("website") and re.match(r"^https?://", s["website"]) and not any(l.get("url") == s["website"] for l in links):
        acts.append(f'<a class="d-btn" href="{e(s["website"])}" target="_blank" rel="noopener"><span><b>公式サイト</b></span></a>')
    if s.get("reservation_url") and re.match(r"^https?://", s["reservation_url"]):
        acts.append(f'<a class="d-btn" href="{e(s["reservation_url"])}" target="_blank" rel="noopener"><span><b>予約する</b><small>予約ページ</small></span></a>')
    q = urllib.parse.quote(f"{s['name']} 福井市{s.get('town') or ''}")
    acts.append(f'<a class="d-btn" href="https://www.google.com/maps/search/?api=1&amp;query={q}" target="_blank" rel="noopener"><span><b>地図で見る</b><small>Googleマップ</small></span></a>')
    for l in links:
        if re.match(r"^https?://", l.get("url") or ""):
            acts.append(f'<a class="d-btn" href="{e(l["url"])}" target="_blank" rel="noopener"><span><b>{e(l.get("label") or LINK_LABEL.get(l.get("kind"), "リンク"))}</b></span></a>')
    out = [f'<a class="back" href="/">一覧にもどる</a>',
           f'<article class="d-wrap{" is-pr" if s.get("is_paid") else ""}">']
    if photos:
        out.append(f'<div class="d-hero"><div class="d-slides"><figure><img src="{e(photo_url(photos[0], base))}" alt="{e(s["name"])}" /></figure></div></div>')
    out.append(f'<header class="d-head"><p class="eyebrow"><span class="band">{"NIGHT" if s.get("category") == "night" else "GOURMET"}</span>'
               + (f'<span class="new-tag">{e(opened_label(s))}</span>' if opened_label(s) else "") + "</p>"
               + f'<div class="d-title"><div><h1>{e(s["name"])}</h1>'
               + (f'<p class="d-catch">{e(s["catch"])}</p>' if s.get("is_paid") and s.get("catch") else "") + "</div></div></header>")
    out.append(f'<div class="d-actions">{"".join(acts)}</div>')
    if s.get("is_paid") and s.get("description"):
        out.append(f'<section class="d-block"><h2><span class="en">MESSAGE</span>お店から</h2><p class="d-desc">{e(s["description"])}</p></section>')
    out.append('<section class="d-block"><h2><span class="en">INFO</span>店舗情報</h2><dl class="d-info">'
               + "".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in info_rows(s)) + "</dl>"
               + ("" if s.get("is_paid") else '<p class="d-small">営業時間などの最新情報は、お店の公式アカウントでご確認ください。</p>') + "</section>")
    out.append("</article>")
    # 中身の薄いページにならないよう、名簿にある事実（エリア・ジャンル・近くのお店）だけで案内を足す
    lead = f"{e(s['name'])}は、{e(zone_name)}エリア" + (f"（福井市{e(s['town'])}）" if s.get("town") else "") + f"にある{e(s.get('genre') or 'お店')}のお店です。"
    out.append(f'<section class="d-block d-around"><h2><span class="en">AREA</span>{e(zone_name)}のお店</h2><p>{lead}</p>'
               + (f'<h3>{e(ZONES.get(s.get("zone"), ""))}の{e(s.get("genre") or "")}</h3><ul>{link_list(near)}</ul>' if near else "")
               + (f'<h3>{e(s["town"])}のほかのお店</h3><ul>{link_list(town)}</ul>' if town else "")
               + '<p><a href="/">ふくいエキマエで、ほかのお店を探す</a></p></section>')
    return "\n".join(out)


def ld_json(s: dict, base: str) -> str:
    kind = "BarOrPub" if s.get("category") == "night" else ("CafeOrCoffeeShop" if s.get("genre") == "カフェ・スイーツ" else "Restaurant")
    d = {"@context": "https://schema.org", "@type": kind, "name": s["name"], "url": f"{SITE}/shop/{s['slug']}/",
         "address": {"@type": "PostalAddress", "addressCountry": "JP", "addressRegion": "福井県", "addressLocality": "福井市",
                     **({"streetAddress": s["address"]} if s.get("address") else {})}}
    if s.get("genre") and kind != "BarOrPub":
        d["servesCuisine"] = s["genre"]
    if s.get("tel"):
        d["telephone"] = s["tel"]
    if s.get("photos"):
        d["image"] = photo_url(s["photos"][0], base)
    if s.get("instagram"):
        d["sameAs"] = [f"https://www.instagram.com/{s['instagram']}/"]
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "ふくいエキマエ", "item": f"{SITE}/"},
        {"@type": "ListItem", "position": 2, "name": s["name"], "item": f"{SITE}/shop/{s['slug']}/"}]}
    j = json.dumps([d, crumbs], ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/ld+json">{j}</script>'


def page(tpl: str, s: dict, shops: list, base: str) -> str:
    url = f"{SITE}/shop/{s['slug']}/"
    title = f"{s['name']}（{s.get('genre') or 'お店'}・{area(s)}）｜ふくいエキマエ"
    desc = (f"{s['name']}は、{ZONE_LONG.get(s.get('zone'), '')}エリア" + (f"（福井市{s['town']}）" if s.get("town") else "")
            + f"の{s.get('genre') or 'お店'}のお店です。" + (s["catch"] if s.get("is_paid") and s.get("catch") else "")
            + "店舗情報と、近くのお店をまとめています。")
    h = tpl
    sub = lambda pat, rep: re.sub(pat, lambda _: rep, h, count=1)
    h = sub(r"<title>.*?</title>", f"<title>{e(title)}</title>")
    h = sub(r'<meta name="description" content="[^"]*" />', f'<meta name="description" content="{e(desc)}" />')
    h = sub(r'<link rel="canonical" href="[^"]*" />', f'<link rel="canonical" href="{url}" />')
    h = sub(r'<meta property="og:url" content="[^"]*" />', f'<meta property="og:url" content="{url}" />')
    h = sub(r'<meta property="og:title" content="[^"]*" />', f'<meta property="og:title" content="{e(s["name"])}｜ふくいエキマエ" />')
    h = sub(r'<meta property="og:description" content="[^"]*" />', f'<meta property="og:description" content="{e(desc)}" />')
    h = sub(r'<meta property="og:type" content="website" />', '<meta property="og:type" content="article" />')
    h = sub(r'<script type="application/ld\+json">.*?</script>', ld_json(s, base))
    h = sub(r'<body data-mode="day">', f'<body data-mode="{"night" if s.get("category") == "night" else "day"}">')
    h = sub(r'<main id="app" class="wrap">', '<main id="app" class="wrap" hidden>')
    h = sub(r'<section id="detail" class="wrap detail" hidden></section>',
            f'<section id="detail" class="wrap detail">\n{detail(s, shops, base)}\n</section>')
    return h


def sitemap(shops: list) -> None:
    p = DOCS / "sitemap.xml"
    keep = [u for u in re.findall(r"  <url>.*?</url>", p.read_text()) if "/shop/" not in u]
    rows = [f"  <url><loc>{SITE}/shop/{s['slug']}/</loc>"
            + (f"<lastmod>{str(s['updated_at'])[:10]}</lastmod>" if s.get("updated_at") else "") + "</url>" for s in shops]
    p.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                 + "\n".join(keep + rows) + "\n</urlset>\n")


def main() -> None:
    base = config()["url"]
    shops = [s for s in load() if SLUG_OK.match(s.get("slug") or "")]
    tpl = (DOCS / "index.html").read_text()
    SHOP_DIR.mkdir(exist_ok=True)
    want = {s["slug"] for s in shops}
    removed = 0
    for d in SHOP_DIR.iterdir():
        if d.is_dir() and d.name not in want:   # 非表示・掲載終了のお店
            shutil.rmtree(d)
            removed += 1
    for s in shops:
        d = SHOP_DIR / s["slug"]
        d.mkdir(exist_ok=True)
        (d / "index.html").write_text(page(tpl, s, shops, base))
    sitemap(shops)
    print(f"お店のページ {len(shops)} 件を作りました（消した {removed} 件）")


if __name__ == "__main__":
    main()
