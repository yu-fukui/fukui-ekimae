"""「Google 要確認」のお店を、電話番号で Google Places API (New) から探し直す（運営だけが見る調べもの）。

代表の指示（2026-10-08）「254件は管理画面で分けて表示させてください。住所と電話番号で確かめ直してOkです。」
- 入力 TELS は「slug:電話番号」をカンマでつないだもの（電話番号はサイトに載せている店の番号）
- Text Search (New) を電話番号で1回ずつ。電話番号を取るので Enterprise の段階（月1,000回まで無料）
- Google の電話番号がサイトの番号とぴったり同じ店だけを「同じ店」とする。保存はせず、ログに place_id だけを出す
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

URL = "https://places.googleapis.com/v1/places:searchText"
FIELDS = "places.id,places.displayName,places.nationalPhoneNumber,places.businessStatus"
MAX_CALLS = int(os.environ.get("MAX_CALLS", "400"))


def digits(t: str) -> str:
    return re.sub(r"\D", "", t or "")


def pretty(d: str) -> str:
    """電話番号をハイフン付きにする（Google が見つけやすい形）"""
    if d.startswith(("090", "080", "070", "050")) and len(d) == 11:
        return f"{d[:3]}-{d[3:7]}-{d[7:]}"
    if d.startswith("0776") and len(d) == 10:
        return f"{d[:4]}-{d[4:6]}-{d[6:]}"
    return d


def search(q: str) -> list:
    body = {"textQuery": q, "languageCode": "ja", "regionCode": "JP", "pageSize": 5,
            "locationBias": {"circle": {"center": {"latitude": 36.0625, "longitude": 136.2200}, "radius": 3000.0}}}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "X-Goog-Api-Key": os.environ["GOOGLE_PLACES_API_KEY"], "X-Goog-FieldMask": FIELDS})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res).get("places", [])
    except urllib.error.HTTPError as e:
        sys.exit(f"Google がエラーを返しました（{e.code}）: {e.read().decode()[:500]}")


def main() -> None:
    pairs = [x.split(":", 1) for x in os.environ.get("TELS", "").split(",") if ":" in x]
    out, calls = [], 0
    for slug, tel in pairs:
        d = digits(tel)
        if len(d) < 10 or calls >= MAX_CALLS:
            continue
        calls += 1
        hit = next((p for p in search(pretty(d)) if digits(p.get("nationalPhoneNumber", "")) == d), None)
        if hit:
            out.append("\t".join([slug, hit["id"], hit.get("businessStatus", ""), (hit.get("displayName") or {}).get("text", "")]))
    print(f"問い合わせ {calls} 回、電話番号が合った店 {len(out)} 件")
    print("@@@RESULT_BEGIN")
    print("\n".join(out))
    print("@@@RESULT_END")


if __name__ == "__main__":
    main()
