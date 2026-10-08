"""中央・大手・順化（福井市）の飲食店を Google Places API (New) で数える（運営だけが見る調べもの）。

代表の指示（2026-10-08）「該当エリアで、Googleで取得できるお店の件数は？」。
- 範囲を小さな円に分けて Nearby Search (New) で問い合わせる。1回20件が上限なので、
  20件返った円は4つに割って問い直す。問い合わせは MAX_CALLS 回で打ち切る（料金の上限）。
- 住所に「中央」「大手」「順化」が入る店だけを数える（福井市内）。
- Google の決まりで、取った店名・住所はリポジトリに保存しない。結果は Actions の成果物（7日で消える）に置く。

  GOOGLE_PLACES_API_KEY=... python scripts/places_count.py
"""
from __future__ import annotations

import csv
import json
import math
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

URL = "https://places.googleapis.com/v1/places:searchNearby"
FIELDS = "places.id,places.displayName,places.formattedAddress,places.primaryType,places.businessStatus"
# 和食・ラーメン・寿司などは種類に「restaurant」も持っているので、ここで拾える
TYPES = ["restaurant", "cafe", "bar", "bakery", "night_club", "meal_takeaway"]
TOWNS = ("中央", "大手", "順化")
# 範囲（福井駅〜片町の周り。3つの町を少し大きめに囲む）
SOUTH, NORTH, WEST, EAST = 36.0555, 36.0705, 136.2090, 136.2340
START_RADIUS = 160.0  # m
MAX_CALLS = int(os.environ.get("MAX_CALLS", "800"))

calls = 0


def nearby(lat: float, lng: float, radius: float, types: list[str]) -> list[dict]:
    global calls
    calls += 1
    body = {"includedTypes": types, "maxResultCount": 20, "languageCode": "ja", "regionCode": "JP",
            "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius}}}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "X-Goog-Api-Key": os.environ["GOOGLE_PLACES_API_KEY"],
        "X-Goog-FieldMask": FIELDS})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res).get("places", [])
    except urllib.error.HTTPError as e:
        sys.exit(f"Google がエラーを返しました（{e.code}）: {e.read().decode()[:500]}")


def search(lat: float, lng: float, radius: float, found: dict) -> None:
    if calls >= MAX_CALLS:
        return
    # includedTypes は最大50種類だが、件数上限（20）に早く当たらないよう種類は1回でまとめて聞く
    places = nearby(lat, lng, radius, TYPES)
    for p in places:
        found[p["id"]] = p
    if len(places) >= 20 and radius > 25:
        r = radius / 2
        d = r / 111_000
        dl = r / (111_000 * math.cos(math.radians(lat)))
        for dy, dx in ((d, dl), (d, -dl), (-d, dl), (-d, -dl)):
            search(lat + dy, lng + dx, r * 1.15, found)


def main() -> None:
    found: dict[str, dict] = {}
    step = START_RADIUS * 1.4
    dlat = step / 111_000
    dlng = step / (111_000 * math.cos(math.radians((SOUTH + NORTH) / 2)))
    lat = SOUTH
    while lat <= NORTH:
        lng = WEST
        while lng <= EAST:
            search(lat, lng, START_RADIUS, found)
            lng += dlng
        lat += dlat
    rows = []
    for p in found.values():
        addr = p.get("formattedAddress", "")
        town = next((t for t in TOWNS if f"福井市{t}" in addr or f"福井県福井市{t}" in addr), "")
        if not town:
            continue
        rows.append({"町": town, "店名": p.get("displayName", {}).get("text", ""), "住所": addr,
                     "種類": p.get("primaryType", ""), "営業": p.get("businessStatus", ""), "place_id": p["id"]})
    out = Path("out"); out.mkdir(exist_ok=True)
    with (out / "places_3towns.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["町", "店名", "住所", "種類", "営業", "place_id"])
        w.writeheader(); w.writerows(sorted(rows, key=lambda r: (r["町"], r["住所"])))
    op = [r for r in rows if r["営業"] in ("OPERATIONAL", "")]
    print(f"問い合わせ回数: {calls}（上限 {MAX_CALLS}）")
    print(f"範囲内で見つかった店（全体）: {len(found)}")
    print(f"中央・大手・順化の店: {len(rows)}（うち営業中 {len(op)}）")
    print("町ごと（営業中）:", dict(Counter(r['町'] for r in op)))
    print("種類（営業中・上位20）:", Counter(r['種類'] for r in op).most_common(20))
    if calls >= MAX_CALLS:
        print("::warning::問い合わせ回数の上限に達しました。件数は少なめに出ている可能性があります")


if __name__ == "__main__":
    if not os.environ.get("GOOGLE_PLACES_API_KEY"):
        sys.exit("GOOGLE_PLACES_API_KEY がありません")
    main()
