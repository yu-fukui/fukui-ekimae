"""翌日ぶんの Threads 投稿を、お店のデータから組み立てて予約キューに足す。

    python scripts/compose.py              # 翌日ぶんを posts/queue.jsonl に足す
    python scripts/compose.py --dry-run    # 足さずに表示だけ
    python scripts/compose.py --date 2026-10-10

投稿は 1 日 5 枠（代表の指示 2026-10-06「投稿回数を5回にしたい、投稿時間も調整して」、10/6「後半3件を1時間早めて」）。
  11:30 お昼（グルメ。カフェ・居酒屋・焼鳥は除く）
  14:30 問いかけ（読む人にコメントで答えてもらう。代表の指示 10/7「視聴者への問いかけ系にする、コメントを増やしていきたい」）
  16:30 有料のお店の紹介（PR 表記つき。有料店がなければ、夕方のカフェ・軽く一杯の居酒屋・焼鳥）
  18:30 晩ごはん・一軒目（カフェ以外のグルメ）
  20:30 二軒目（バー・スナック・ラウンジ）
その日が定休日の店（定休日の欄にその曜日がある店）は選ばない。

文章は AI に書かせず、データにある事実（店名・ジャンル・エリア・公式アカウント・お店が書いた紹介文）だけで作る。
公式 Instagram があるお店は @ で紐付ける（Threads は Instagram と同じユーザー名）。
同じお店が続かないよう、紹介済みの記録を state/featured.json に残し（毎晩コミットする）、全店を一巡するまで同じ店は出さない。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
QUEUE = ROOT / "posts/queue.jsonl"
FEATURED = ROOT / "state/featured.json"
LOCAL_DATA = ROOT / "docs/data/shops.json"
TZ = ZoneInfo("Asia/Tokyo")
# ワークフローでは vars.SITE_URL が未設定だと空文字で渡ってくるので、空でも既定の URL にする
SITE = (os.environ.get("SITE_URL") or "https://ekimae.fukui-fukui.com/").rstrip("/") + "/"
ZONES = {"ekimae": "福井駅前", "katamachi": "片町"}
PR_INTERVAL_DAYS = 30   # 有料のお店は 30 日に 1 回紹介する


CONFIG_JS = ROOT / "docs/config.js"


def _supabase() -> tuple[str, str] | None:
    """Supabase の URL と公開キー。Variables が無ければ docs/config.js（サイトと同じ公開の値）から読む。"""
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_ANON_KEY")
    if url and key:
        return url, key
    if CONFIG_JS.exists():
        cfg = CONFIG_JS.read_text(encoding="utf-8")
        u = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg)
        k = re.search(r'supabaseAnonKey:\s*"([^"]+)"', cfg)
        if u and k:
            return u.group(1), k.group(1)
    return None


def load_shops() -> list[dict]:
    """いまサイトに出ているお店（public_shops）。読めないときだけ docs/data/shops.json（古い写し）を使う。"""
    sb = _supabase()
    if sb:
        url, key = sb
        out: list[dict] = []
        try:
            for offset in range(0, 10000, 1000):
                req = urllib.request.Request(f"{url}/rest/v1/public_shops?select=*&order=slug&offset={offset}&limit=1000",
                                             headers={"apikey": key, "Authorization": f"Bearer {key}"})
                with urllib.request.urlopen(req, timeout=30) as res:
                    page = json.load(res)
                out += page
                if len(page) < 1000:
                    return out
        except OSError as e:
            print(f"::warning::Supabase から読めませんでした（{e}）。古い写しを使います。")
    return json.loads(LOCAL_DATA.read_text(encoding="utf-8"))


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def shop_url(shop: dict) -> str:
    return f"{SITE}#/shop/{shop['slug']}"


def mention(shop: dict) -> str:
    """お店の Instagram へのリンク。@ のメンションではなく URL にする（代表の指示 2026-10-04）。"""
    # 複数店舗の共通アカウント（チェーン・本部）は紐付けない（代表の指示 2026-10-04）
    if shop.get("instagram_shared"):
        return ""
    ig = (shop.get("instagram") or "").strip().lstrip("@")
    return f"https://www.instagram.com/{ig}/" if ig else ""


def where(shop: dict) -> str:
    town = f"（{shop['town']}）" if shop.get("town") else ""
    return f"{ZONES.get(shop['zone'], '')}{town}"


def lunch_text(shop: dict) -> str:
    lines = [f"きょうのお昼、{where(shop)}で。", "", f"🍴 {shop['name']}", f"{shop['genre']}"]
    if mention(shop):
        lines += ["", f"最新の営業日やメニューは公式 Instagram で\n{mention(shop)}"]
    lines += ["", f"お店の場所・ほかのお店は「ふくいエキマエ」で {shop_url(shop)}"]
    return "\n".join(lines)


def cafe_text(shop: dict) -> str:
    return lunch_text(shop).replace("きょうのお昼", "午後のひと休み")


def evening_text(shop: dict) -> str:
    return lunch_text(shop).replace("きょうのお昼", "夕方のひと休み・軽く一杯")


def dinner_text(shop: dict) -> str:
    return lunch_text(shop).replace("きょうのお昼", "今夜の一軒目").replace("🍴", "🍽")


def night_text(shop: dict) -> str:
    lines = [f"今夜の二軒目、{where(shop)}で。", "", f"🍸 {shop['name']}", f"{shop['genre']}"]
    if mention(shop):
        lines += ["", f"営業日・イベントは公式 Instagram で\n{mention(shop)}"]
    lines += ["", f"夜のお店一覧 {shop_url(shop)}", "", "※20歳未満の飲酒は法律で禁止されています"]
    return "\n".join(lines)


def pr_text(shop: dict) -> str:
    lines = ["【PR】", f"{where(shop)}の {shop['name']}"]
    if shop.get("catch"):
        lines += ["", shop["catch"]]
    if shop.get("description"):
        desc = shop["description"]
        lines += ["", desc if len(desc) <= 180 else desc[:178] + "…"]
    if shop.get("hours"):
        lines += ["", f"🕒 {shop['hours']}" + (f"（定休日：{shop['holiday']}）" if shop.get("holiday") else "")]
    if mention(shop):
        lines += [f"公式 Instagram {mention(shop)}"]
    lines += ["", f"写真・詳しくは {shop_url(shop)}"]
    if shop.get("category") == "night":
        lines += ["", "※20歳未満の飲酒は法律で禁止されています"]
    return "\n".join(lines)


def pick(pool: list[dict], seen: set[str], rng: random.Random) -> dict | None:
    """まだ紹介していない店から選ぶ。共通アカウントでない店を優先し、共通アカウントの店は後回し。一巡したら記録を消してやり直す。"""
    if not pool:
        return None
    fresh = [s for s in pool if s["slug"] not in seen]
    if not fresh:
        seen.difference_update(s["slug"] for s in pool)
        fresh = pool
    own = [s for s in fresh if not s.get("instagram_shared")]
    return rng.choice(own or fresh)


def eligible(shop: dict) -> bool:
    """無料の枠で紹介してよい店：Instagram がある店だけ（代表が Instagram を確認済み。2026-10-04 の指示）。"""
    return bool((shop.get("instagram") or "").strip()) and not shop.get("is_paid")


# 14:30 の問いかけ。お店の事実は書かず、読む人の経験を聞く。日付で順に回す。
# 型は「場面 → 選択肢を並べる → 迷っていると打ち明ける → 教えてください」（代表が見本にした投稿の形）。
QUESTIONS = [
    """福井駅前で、県外の友だちと晩ごはん1回だけ。外せないのって、結局どれですか？

・ソースカツ丼
・おろしそば
・地魚と地酒
・焼き鳥

どれも捨てがたくて決めきれない…。
地元の人、「ここだけは連れていけ」って一軒を教えてください！""",
    """片町で二次会。10人くらいで入れるお店、みなさんどうやって探してます？

・いつもの行きつけ
・幹事の知り合いのお店
・その場で歩いて探す

当日に慌てがちなので、幹事経験のある人のコツを聞きたいです。""",
    """福井駅前で一人飲みするなら、どんなお店に入りますか？

・カウンターの居酒屋
・焼き鳥屋
・バー
・立ち飲み

一人だと最初の一軒に入るのが少し勇気いる…。
「ここは一人でも入りやすい」ってお店があれば教えてください！""",
    """片町の〆、みなさんは何派ですか？

・ラーメン
・おろしそば
・お茶漬け・おにぎり
・〆はしない

飲んだあとの一杯、福井の人のおすすめが知りたいです。""",
    """出張で福井駅前に1泊。夜は1軒だけ行けるとしたら、どこに行きます？

・地魚の刺身と地酒
・ソースカツ丼でさっと
・越前がにが出るお店（冬）
・ホテル近くのバー

初めての福井で迷う人が多いと思うので、地元の人の答えを聞かせてください。""",
    """福井駅前のランチ、1,000円前後で満足できるお店ってどこですか？

定食、そば、洋食、中華…
候補が多いようで、いざ探すと決めきれない…。
平日のお昼によく行くお店があれば、コメントで教えてください！""",
    """接待で福井駅前・片町のお店を選ぶとき、いちばん気にするのは何ですか？

・個室があるか
・駅から近いか
・地酒の品ぞろえ
・料理のコースがあるか

経験のある人の「失敗しない選び方」を聞きたいです。""",
    """何年も通っている片町のお店、ありますか？

長く続いているお店ほど、通う理由があると思うんです。
「何年通ってる」「ここがいい」ってお店があれば、ぜひ教えてください。""",
    """福井駅前でカフェに入るなら、どっち派ですか？

・ゆっくり作業できるお店
・おしゃべりしやすいお店
・甘いものが目当て
・テイクアウトでさっと

用途で使い分けている人、それぞれのおすすめを聞かせてください！""",
    """雨の日の福井駅前、濡れずに行けるごはん屋さんってどこですか？

駅の近くで、傘をささずに入れるお店があると助かる…。
地元の人の「雨の日はここ」を教えてください。""",
]


def question_text(day: date) -> str:
    return QUESTIONS[(day - date(2026, 10, 8)).days % len(QUESTIONS)]


WEEKDAYS = "月火水木金土日"


# 祝日（代表 10/8「今週末は3連休、10/12（月）は祝日です。」）。年が変わる前に足す
HOLIDAYS = {
    date(2026, 10, 12), date(2026, 11, 3), date(2026, 11, 23),
    date(2027, 1, 1), date(2027, 1, 11), date(2027, 2, 11), date(2027, 2, 23), date(2027, 3, 22),
    date(2027, 4, 29), date(2027, 5, 3), date(2027, 5, 4), date(2027, 5, 5), date(2027, 7, 19),
    date(2027, 8, 11), date(2027, 9, 20), date(2027, 9, 23), date(2027, 10, 11), date(2027, 11, 3), date(2027, 11, 23),
}


def open_on(shop: dict, day: date) -> bool:
    """定休日の欄にその曜日がある店は、その日は出さない（10/6 GINCHIYO は火曜定休）。祝日は「祝」がある店を出さない。"""
    holiday = shop.get("holiday") or ""
    if WEEKDAYS[day.weekday()] in holiday:
        return False
    return not (day in HOLIDAYS and "祝" in holiday and "祝日は営業" not in holiday and "祝日営業" not in holiday)


def compose(day: date, shops: list[dict], featured: dict) -> list[dict]:
    # 試験用の複製（slug が -gtest で終わる。例：洋食堂の Google 表示テスト）は投稿に出さない。有料にしても PR に選ばない
    shops = [s for s in shops if not s["slug"].endswith("-gtest")]
    rng = random.Random(day.isoformat())
    seen = set(featured.get("seen", []))
    pr_last = featured.get("pr_last", {})
    gourmet = [s for s in shops if s["category"] == "gourmet" and eligible(s) and open_on(s, day)]
    night = [s for s in shops if s["category"] == "night" and eligible(s) and open_on(s, day)]
    paid_due = sorted(
        (s for s in shops if s.get("is_paid") and open_on(s, day) and
         (s["slug"] not in pr_last or (day - date.fromisoformat(pr_last[s["slug"]])).days >= PR_INTERVAL_DAYS)),
        key=lambda s: pr_last.get(s["slug"], ""))
    drink = ("居酒屋", "焼鳥・串")
    cafe = [x for x in gourmet if x["genre"] == "カフェ・スイーツ"]
    # お昼の枠に居酒屋は出さない（夜だけの店が多い。10/5 しの﨑の件）
    lunch = [x for x in gourmet if x["genre"] != "カフェ・スイーツ" and x["genre"] not in drink]
    evening = [x for x in gourmet if x["genre"] in drink]
    dinner = [x for x in gourmet if x["genre"] != "カフェ・スイーツ"]

    slots: list[tuple[str, str]] = []

    def add(hm: str, pool: list[dict], make) -> None:
        if (s := pick(pool, seen, rng)):
            seen.add(s["slug"]); slots.append((hm, make(s)))

    add("11:30", lunch or gourmet, lunch_text)
    slots.append(("14:30", question_text(day)))
    if paid_due:
        s = paid_due[0]; pr_last[s["slug"]] = day.isoformat(); slots.append(("16:30", pr_text(s)))
    else:
        add("16:30", evening + cafe, evening_text)
    add("18:30", dinner, dinner_text)
    add("20:30", night, night_text)

    featured["seen"] = sorted(seen)
    featured["pr_last"] = pr_last
    items = []
    for hm, text in slots:
        at = datetime.fromisoformat(f"{day.isoformat()}T{hm}:00").replace(tzinfo=TZ)
        digest = hashlib.sha1(text.encode()).hexdigest()[:4]
        items.append({"id": f"p-{at:%Y%m%d%H%M}-{digest}", "text": text, "scheduled_at": at.isoformat()})
    return items


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="この日のぶんを作る（既定は翌日）")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    day = date.fromisoformat(a.date) if a.date else (datetime.now(TZ) + timedelta(days=1)).date()

    existing = [json.loads(l) for l in QUEUE.read_text(encoding="utf-8").splitlines() if l.strip()] if QUEUE.exists() else []
    if any(str(i.get("scheduled_at", "")).startswith(day.isoformat()) for i in existing):
        print(f"{day} のぶんはもうキューにあります。足しません。")
        return
    featured = load_json(FEATURED, {"seen": [], "pr_last": {}})
    items = compose(day, load_shops(), featured)
    for it in items:
        print(f"── {it['scheduled_at']}\n{it['text']}\n")
    if a.dry_run:
        return
    with QUEUE.open("a", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    FEATURED.write_text(json.dumps(featured, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(items)} 本を予約しました。")


if __name__ == "__main__":
    main()
