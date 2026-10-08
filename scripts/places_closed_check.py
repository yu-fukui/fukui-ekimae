"""サイトに載っているお店を Google Places API (New) で1軒ずつ探し、閉業・休業していないかを確かめる（運営だけが見る調べもの）。

代表の指示（2026-10-08）「サイト掲載済みの店をGoogleで検索し、閉業のチェックを進めてください。」
- Text Search (New) を「店名 福井市＋町名」で1回ずつ（Pro の段階。月5,000回まで無料）
- 店名・住所・営業の状態だけを取る。Google の決まりで保存はせず、結果は Actions の成果物（7日）とまとめ画面に置く
- 「閉業」「休業中」「見つからない」「別の店らしい（名前が合わない）」を一覧にする。サイトから外すかは代表が決める
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import urllib.error
import urllib.request
import unicodedata
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compose  # noqa: E402  public_shops の読み方を使い回す

URL = "https://places.googleapis.com/v1/places:searchText"
FIELDS = "places.id,places.displayName,places.formattedAddress,places.businessStatus"
MAX_CALLS = int(os.environ.get("MAX_CALLS", "1200"))
SKIP = {"s4bb210af-gtest"}  # 試験用の複製


def norm(t: str) -> str:
    t = unicodedata.normalize("NFKC", t or "").lower()
    return re.sub(r"[\s・･&＆'’.,、。!！?？()（）「」\-/|｜]", "", t)


def search(q: str) -> dict:
    body = {"textQuery": q, "languageCode": "ja", "regionCode": "JP", "pageSize": 1,
            "locationBias": {"circle": {"center": {"latitude": 36.0625, "longitude": 136.2200}, "radius": 2000.0}}}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "X-Goog-Api-Key": os.environ["GOOGLE_PLACES_API_KEY"], "X-Goog-FieldMask": FIELDS})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            ps = json.load(res).get("places", [])
    except urllib.error.HTTPError as e:
        sys.exit(f"Google がエラーを返しました（{e.code}）: {e.read().decode()[:500]}")
    return ps[0] if ps else {}


def main() -> None:
    shops = [s for s in compose.load_shops() if s["slug"] not in SKIP]
    rows, calls = [], 0
    for s in shops:
        if calls >= MAX_CALLS:
            break
        calls += 1
        p = search(f"{s['name']} 福井市{s.get('town') or ''}")
        gname = (p.get("displayName") or {}).get("text", "")
        addr = p.get("formattedAddress", "")
        a, b = norm(s["name"]), norm(gname)
        same = bool(p) and (a in b or b in a or len(set(a) & set(b)) >= max(2, int(min(len(a), len(b)) * 0.6)))
        in_fukui = "福井市" in addr
        status = p.get("businessStatus", "")
        if not p:
            verdict = "見つからない"
        elif not in_fukui or not same:
            verdict = "別の店らしい"
        elif status == "CLOSED_PERMANENTLY":
            verdict = "閉業"
        elif status == "CLOSED_TEMPORARILY":
            verdict = "休業中"
        else:
            verdict = "営業中"
        rows.append({"判定": verdict, "slug": s["slug"], "サイトの店名": s["name"], "町": s.get("town", ""),
                     "Googleの店名": gname, "Googleの住所": addr, "状態": status, "place_id": p.get("id", "")})
    out = Path("out"); out.mkdir(exist_ok=True)
    order = {"閉業": 0, "休業中": 1, "見つからない": 2, "別の店らしい": 3, "営業中": 4}
    rows.sort(key=lambda r: (order[r["判定"]], r["町"], r["サイトの店名"]))
    with (out / "closed_check.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    c = Counter(r["判定"] for r in rows)
    print(f"問い合わせ回数: {calls}（サイトの店 {len(shops)} 軒）")
    print("判定ごと:", dict(c))
    print("@@@RESULT_BEGIN")
    for r in rows:
        if r["判定"] != "営業中":
            print("\t".join([r["判定"], r["slug"], r["サイトの店名"], r["町"], r["Googleの店名"], r["状態"]]))
    print("@@@RESULT_END")


if __name__ == "__main__":
    if not os.environ.get("GOOGLE_PLACES_API_KEY"):
        sys.exit("GOOGLE_PLACES_API_KEY がありません")
    main()
