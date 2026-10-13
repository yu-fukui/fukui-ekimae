"""出た投稿ごとの数字（閲覧・いいね・返信・再投稿・引用）を Threads API で取り、insights/投稿の数字.jsonl に残す。

代表 10/13「いしかわとエキマエの問いかけ系のインタラクションが良いと感じますが、数値はいかがでしょうか？」（統括経由）。
- state/posted.json（出た投稿の post_id）と posts/queue.jsonl（本文・予定時刻）を突き合わせる
- 1 行 1 投稿。毎回まるごと書き直す（最新の数字だけ残す）
使い方: THREADS_ACCESS_TOKEN=xxx python scripts/投稿の数字.py
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://graph.threads.net/v1.0"
JST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
POSTED = ROOT / "state/posted.json"
QUEUE = ROOT / "posts/queue.jsonl"
OUT = ROOT / "insights/投稿の数字.jsonl"
METRICS = ["views", "likes", "replies", "reposts", "quotes"]


def get(path: str, **params) -> dict:
    params["access_token"] = os.environ["THREADS_ACCESS_TOKEN"]
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()[:300]}


def queue_items() -> dict[str, dict]:
    items = {}
    if QUEUE.exists():
        for line in QUEUE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            d = json.loads(line)
            items[d.get("id", "")] = d
    return items


def main() -> None:
    posted = json.loads(POSTED.read_text(encoding="utf-8")).get("posted", {})
    queue = queue_items()
    now = datetime.now(JST).isoformat(timespec="seconds")
    rows = []
    for qid, p in posted.items():
        pid = p.get("post_id")
        if not pid:
            continue
        d = get(f"{pid}/insights", metric=",".join(METRICS))
        row = {"id": qid, "post_id": pid, "posted_at": p.get("posted_at"), "permalink": p.get("permalink"), "measured_at": now}
        if "error" in d:
            row["error"] = d["error"]
        else:
            for m in d.get("data", []):
                vals = m.get("values") or []
                row[m.get("name")] = (vals[0].get("value") if vals else (m.get("total_value") or {}).get("value"))
        q = queue.get(qid, {})
        row["scheduled_at"] = q.get("scheduled_at")
        row["text"] = q.get("text", "")
        rows.append(row)
    rows.sort(key=lambda r: r.get("posted_at") or "")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    ok = [r for r in rows if "error" not in r]
    print(f"{len(rows)} 本（取れた {len(ok)} 本）を {OUT.relative_to(ROOT)} に書きました")


if __name__ == "__main__":
    main()
