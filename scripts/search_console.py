"""Search Console の数字を取って insights/search-console/ に残す。

代表 10/13「Search Console は、エキマエ開発からは見られるようにしてください。」
サービスアカウントの鍵（JSON）を GitHub Secrets の GSC_SERVICE_ACCOUNT_JSON に置き、
そのメールアドレスを Search Console の ekimae.fukui-fukui.com に「制限付き」ユーザーで追加して使う。
鍵の中身は表に出さない。

残すもの：
- 直近28日の検索の表示回数・クリック（合計と、ページ別の上位）
- サイトマップの状態
- 主なページが Google に登録されているか（URL 検査）
"""
import datetime
import json
import os
import pathlib
import sys
import urllib.parse

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

SITE_HOST = "ekimae.fukui-fukui.com"
SITE_URL = f"https://{SITE_HOST}/"
CHECK_URLS = [SITE_URL, SITE_URL + "katamachi/"]
OUT = pathlib.Path("insights/search-console")
API = "https://searchconsole.googleapis.com"


def session() -> requests.Session:
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON", "")
    if not raw:
        sys.exit("GSC_SERVICE_ACCOUNT_JSON がありません（GitHub Secrets に置いてください）")
    cred = service_account.Credentials.from_service_account_info(
        json.loads(raw), scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
    cred.refresh(Request())
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {cred.token}"
    return s


def pick_property(s: requests.Session) -> str:
    r = s.get(f"{API}/webmasters/v3/sites")
    r.raise_for_status()
    sites = [x["siteUrl"] for x in r.json().get("siteEntry", [])]
    for want in (SITE_URL, "sc-domain:fukui-fukui.com", f"sc-domain:{SITE_HOST}"):
        if want in sites:
            return want
    sys.exit(f"サービスアカウントから見えるプロパティに {SITE_HOST} がありません：{sites}")


def query(s, prop, body):
    r = s.post(f"{API}/webmasters/v3/sites/{urllib.parse.quote(prop, safe='')}/searchAnalytics/query", json=body)
    r.raise_for_status()
    return r.json().get("rows", [])


def main() -> None:
    s = session()
    prop = pick_property(s)
    today = datetime.date.today()
    end = today - datetime.timedelta(days=3)  # 数字が出そろうまで2〜3日かかる
    start = end - datetime.timedelta(days=27)
    rng = {"startDate": start.isoformat(), "endDate": end.isoformat()}

    total = query(s, prop, rng)
    pages = query(s, prop, {**rng, "dimensions": ["page"], "rowLimit": 50})
    queries = query(s, prop, {**rng, "dimensions": ["query"], "rowLimit": 30})

    r = s.get(f"{API}/webmasters/v3/sites/{urllib.parse.quote(prop, safe='')}/sitemaps")
    sitemaps = r.json().get("sitemap", []) if r.ok else []

    inspections = []
    for u in CHECK_URLS:
        r = s.post(f"{API}/v1/urlInspection/index:inspect", json={"inspectionUrl": u, "siteUrl": prop})
        res = r.json().get("inspectionResult", {}).get("indexStatusResult", {}) if r.ok else {"error": r.status_code}
        inspections.append((u, res))

    t = total[0] if total else {"clicks": 0, "impressions": 0, "ctr": 0, "position": 0}
    L = [f"# Search Console {today}", "",
         f"- プロパティ：{prop}",
         f"- 期間：{start} 〜 {end}（28日）",
         f"- 表示回数 {t['impressions']:.0f} ／ クリック {t['clicks']:.0f} ／ 平均掲載順位 {t['position']:.1f}",
         f"- 検索に出たページの数：{len(pages)}（上位50まで）", "",
         "## 主なページの登録状況（URL 検査）", ""]
    for u, res in inspections:
        L.append(f"- {u}：{res.get('coverageState', res)}（最終クロール {res.get('lastCrawlTime', '-')}）")
    L += ["", "## サイトマップ", ""]
    for m in sitemaps:
        n = sum(int(c.get("submitted", 0)) for c in m.get("contents", []))
        L.append(f"- {m.get('path')}：送信 {n} 件、エラー {m.get('errors', 0)}、警告 {m.get('warnings', 0)}、最終読込 {m.get('lastDownloaded', '-')}")
    L += ["", "## ページ別（表示回数の多い順）", "", "| ページ | 表示 | クリック | 順位 |", "|---|---:|---:|---:|"]
    for p in sorted(pages, key=lambda x: -x["impressions"]):
        L.append(f"| {p['keys'][0]} | {p['impressions']:.0f} | {p['clicks']:.0f} | {p['position']:.1f} |")
    L += ["", "## 検索された言葉（上位30）", "", "| 言葉 | 表示 | クリック | 順位 |", "|---|---:|---:|---:|"]
    for q in sorted(queries, key=lambda x: -x["impressions"]):
        L.append(f"| {q['keys'][0]} | {q['impressions']:.0f} | {q['clicks']:.0f} | {q['position']:.1f} |")

    OUT.mkdir(parents=True, exist_ok=True)
    text = "\n".join(L) + "\n"
    (OUT / f"{today}.md").write_text(text)
    (OUT / "latest.md").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
