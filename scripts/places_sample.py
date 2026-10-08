"""Google Places API (New) で、サンプルのお店の詳細を全部の項目で取る（デモ用・運営だけが見る）。

代表の指示（2026-10-08）「サンプルで5件取得してほしい」。
Text Search (New) を店名＋住所で1回ずつ問い合わせる（Enterprise + Atmosphere の段階。月1,000回まで無料）。
Google の決まりで保存はしない。結果は Actions のログ（まとめ画面）にだけ出す。

  GOOGLE_PLACES_API_KEY=... python scripts/places_sample.py "店名 住所" ...
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

URL = "https://places.googleapis.com/v1/places:searchText"
FIELDS = ",".join("places." + f for f in [
    "id", "displayName", "formattedAddress", "location", "primaryTypeDisplayName", "businessStatus",
    "googleMapsUri", "websiteUri", "nationalPhoneNumber", "regularOpeningHours", "currentOpeningHours",
    "rating", "userRatingCount", "priceLevel", "priceRange", "reviews", "photos", "editorialSummary",
    "takeout", "delivery", "dineIn", "reservable", "servesBreakfast", "servesLunch", "servesDinner",
    "servesBeer", "servesWine", "servesCocktails", "servesCoffee", "servesDessert", "servesVegetarianFood",
    "goodForChildren", "goodForGroups", "outdoorSeating", "liveMusic", "allowsDogs", "restroom",
    "paymentOptions", "parkingOptions", "accessibilityOptions",
])


def search(q: str) -> dict:
    body = {"textQuery": q, "languageCode": "ja", "regionCode": "JP", "pageSize": 1}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "X-Goog-Api-Key": os.environ["GOOGLE_PLACES_API_KEY"],
        "X-Goog-FieldMask": FIELDS})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            places = json.load(res).get("places", [])
    except urllib.error.HTTPError as e:
        sys.exit(f"Google がエラーを返しました（{e.code}）: {e.read().decode()[:800]}")
    p = places[0] if places else {}
    # 写真は名前（参照）と撮った人だけ残す。画像そのものは取らない（別料金）
    p["photos"] = [{"name": x.get("name"), "authorAttributions": x.get("authorAttributions")} for x in p.get("photos", [])[:3]]
    return p


def photo(name: str) -> str:
    """写真1枚を小さめ（幅480px）で取り、base64 で返す。Place Photos は1枚ごとに料金（月1,000枚まで無料）。"""
    import base64
    url = f"https://places.googleapis.com/v1/{name}/media?maxWidthPx=480&skipHttpRedirect=true&key={os.environ['GOOGLE_PLACES_API_KEY']}"
    with urllib.request.urlopen(url, timeout=30) as res:
        uri = json.load(res)["photoUri"]
    with urllib.request.urlopen(uri, timeout=30) as res:
        return base64.b64encode(res.read()).decode()


if __name__ == "__main__":
    if not os.environ.get("GOOGLE_PLACES_API_KEY"):
        sys.exit("GOOGLE_PLACES_API_KEY がありません")
    out = {q: search(q) for q in sys.argv[1:]}
    n = int(os.environ.get("PHOTOS", "0"))
    if n:
        # 写真の中身はログにだけ出す。1行が長すぎると落ちるので 2,000 字ずつに分ける
        for q, p in out.items():
            for k, ph in enumerate(p.get("photos", [])[:n]):
                b = photo(ph["name"])
                print(f"@@@PHOTO_BEGIN {p.get('id')} {k}")
                for i in range(0, len(b), 2000):
                    print(b[i:i + 2000])
                print("@@@PHOTO_END")
    print("@@@SAMPLE_JSON_BEGIN")
    # 1行が長すぎるとログから落ちるので、行を分けて出す
    print(json.dumps(out, ensure_ascii=False, indent=1))
    print("@@@SAMPLE_JSON_END")
