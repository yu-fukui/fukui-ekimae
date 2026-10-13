"""Google アナリティクス（ふくいエキマエ G-H9J2X4WZBW）の数字を取って insights/ga/ に残す。

代表 10/13「GA読み取りもできるようにして」。
Search Console と同じサービスアカウントの鍵（Secrets の GSC_SERVICE_ACCOUNT_JSON）を使う。
そのメールアドレスを GA のプロパティに「閲覧者」で足し、Google Cloud で「Google Analytics Data API」を有効にしておく。
プロパティID（数字）は GA4_PROPERTY_ID（Actions の Variables か Secrets）。無いときは Admin API で
G-H9J2X4WZBW の入ったプロパティを探す（「Google Analytics Admin API」も有効なときだけ）。
"""
import datetime
import json
import os
import pathlib
import sys

import requests
from google.auth.transport.requests import Request
from google.oauth2 import service_account

MEASUREMENT_ID = "G-H9J2X4WZBW"
OUT = pathlib.Path("insights/ga")
DATA = "https://analyticsdata.googleapis.com/v1beta"
ADMIN = "https://analyticsadmin.googleapis.com/v1beta"


def session() -> requests.Session:
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON", "")
    if not raw:
        sys.exit("GSC_SERVICE_ACCOUNT_JSON がありません（GitHub Secrets に置いてください）")
    cred = service_account.Credentials.from_service_account_info(
        json.loads(raw), scopes=["https://www.googleapis.com/auth/analytics.readonly"])
    cred.refresh(Request())
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {cred.token}"
    return s


def find_property(s: requests.Session) -> str:
    pid = os.environ.get("GA4_PROPERTY_ID", "").strip()
    if pid:
        return pid.removeprefix("properties/")
    r = s.get(f"{ADMIN}/accountSummaries", params={"pageSize": 200})
    if not r.ok:
        sys.exit(f"GA4_PROPERTY_ID が無く、Admin API でも探せませんでした（{r.status_code}）。"
                 "GA の「管理 → プロパティの設定」にある数字を、Actions の Variables に GA4_PROPERTY_ID で入れてください")
    props = [p["property"] for a in r.json().get("accountSummaries", []) for p in a.get("propertySummaries", [])]
    for prop in props:
        st = s.get(f"{ADMIN}/{prop}/dataStreams")
        if st.ok and any(x.get("webStreamData", {}).get("measurementId") == MEASUREMENT_ID for x in st.json().get("dataStreams", [])):
            return prop.removeprefix("properties/")
    sys.exit(f"サービスアカウントから見えるプロパティに {MEASUREMENT_ID} がありません（見えるもの：{props}）。"
             "GA の「管理 → プロパティのアクセス管理」で、サービスアカウントを「閲覧者」で足してください")


def report(s, pid, body) -> list:
    r = s.post(f"{DATA}/properties/{pid}:runReport", json=body)
    if not r.ok:
        sys.exit(f"GA の数字を読めませんでした（{r.status_code}）：{r.text[:300]}")
    j = r.json()
    dims = [d["name"] for d in j.get("dimensionHeaders", [])]
    mets = [m["name"] for m in j.get("metricHeaders", [])]
    return [{**{d: v["value"] for d, v in zip(dims, row.get("dimensionValues", []))},
             **{m: v["value"] for m, v in zip(mets, row.get("metricValues", []))}} for row in j.get("rows", [])]


def table(head: list, rows: list) -> list:
    return ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]


def main() -> None:
    s = session()
    pid = find_property(s)
    today = datetime.date.today()
    rng = [{"startDate": "28daysAgo", "endDate": "yesterday"}]
    total = report(s, pid, {"dateRanges": rng, "metrics": [{"name": n} for n in ("activeUsers", "sessions", "screenPageViews")]})
    daily = report(s, pid, {"dateRanges": [{"startDate": "13daysAgo", "endDate": "yesterday"}], "dimensions": [{"name": "date"}],
                            "metrics": [{"name": "activeUsers"}, {"name": "screenPageViews"}], "orderBys": [{"dimension": {"dimensionName": "date"}}]})
    channels = report(s, pid, {"dateRanges": rng, "dimensions": [{"name": "sessionDefaultChannelGroup"}],
                               "metrics": [{"name": "sessions"}], "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}]})
    sources = report(s, pid, {"dateRanges": rng, "dimensions": [{"name": "sessionSource"}], "metrics": [{"name": "sessions"}],
                              "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}], "limit": 10})
    events = report(s, pid, {"dateRanges": rng, "dimensions": [{"name": "eventName"}], "metrics": [{"name": "eventCount"}],
                             "orderBys": [{"metric": {"metricName": "eventCount"}, "desc": True}]})
    # どのお店が見られたか（shop_view。代表が 10/13 にカスタム定義へ店名・エリア・ジャンルを登録）
    shop_filter = {"filter": {"fieldName": "eventName", "stringFilter": {"value": "shop_view"}}}
    try:
        shops = report(s, pid, {"dateRanges": rng, "dimensions": [{"name": "customEvent:shop_name"}, {"name": "customEvent:shop_zone"}],
                                "metrics": [{"name": "eventCount"}], "dimensionFilter": shop_filter,
                                "orderBys": [{"metric": {"metricName": "eventCount"}, "desc": True}], "limit": 30})
    except SystemExit as err:
        shops, shop_err = [], str(err)
    else:
        shop_err = ""

    t = total[0] if total else {"activeUsers": 0, "sessions": 0, "screenPageViews": 0}
    L = [f"# Google アナリティクス {today}", "", f"- プロパティ：{pid}（{MEASUREMENT_ID}）", "- 期間：直近28日（きのうまで）",
         f"- 見た人 {t['activeUsers']} ／ 訪問 {t['sessions']} ／ ページ表示 {t['screenPageViews']}", "",
         "## 日ごと（直近14日）", ""]
    L += table(["日付", "見た人", "ページ表示"], [(f"{d['date'][4:6]}/{d['date'][6:]}", d["activeUsers"], d["screenPageViews"]) for d in daily])
    L += ["", "## どこから来たか", ""] + table(["経路", "訪問"], [(c["sessionDefaultChannelGroup"], c["sessions"]) for c in channels])
    L += ["", "### 参照元（上位10）", ""] + table(["参照元", "訪問"], [(c["sessionSource"], c["sessions"]) for c in sources])
    L += ["", "## 見られたお店（shop_view 上位30）", ""]
    L += table(["店名", "エリア", "回数"], [(x["customEvent:shop_name"], x["customEvent:shop_zone"], x["eventCount"]) for x in shops]) if shops \
        else [f"（まだ数字がありません{('：' + shop_err) if shop_err else ''}）"]
    L += ["", "## イベント", ""] + table(["イベント", "回数"], [(x["eventName"], x["eventCount"]) for x in events])

    OUT.mkdir(parents=True, exist_ok=True)
    text = "\n".join(L) + "\n"
    (OUT / f"{today}.md").write_text(text)
    (OUT / "latest.md").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
