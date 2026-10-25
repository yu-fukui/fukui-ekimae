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
    return f"{SITE}shop/{shop['slug']}/"


def with_utm(text: str, slot: str, item_id: str) -> str:
    """サイトへのリンクに、どの投稿から来たか分かる印を付ける（代表 10/13「つける」）。GA の参照元・キャンペーンで見られる。"""
    q = f"?utm_source=threads&utm_medium=social&utm_campaign=ekimae_{slot}&utm_content={item_id}"
    out = re.sub(rf"({re.escape(SITE)}shop/[A-Za-z0-9_-]+/)(?=\s|$)", lambda m: m.group(1) + q, text)
    return out if len(out) <= 500 else text   # Threads の上限（500字）を超えるなら印は付けない


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


def lunch_text(shop: dict, lead: str = "お昼ごはんの候補") -> str:
    # 「きょう」と書くと、その日に開いているか確かめていないお店でも今日行けるように読めるので、日付に寄らない書き出しにする
    lines = [f"{lead}、{where(shop)}から。", "", f"🍴 {shop['name']}", f"{shop['genre']}"]
    if mention(shop):
        lines += ["", f"最新の営業日やメニューは公式 Instagram で\n{mention(shop)}"]
    lines += ["", f"お店の場所・ほかのお店は「ふくいエキマエ」で {shop_url(shop)}"]
    return "\n".join(lines)


def cafe_text(shop: dict) -> str:
    return lunch_text(shop, "午後のひと休み")


def evening_text(shop: dict) -> str:
    return lunch_text(shop, "夕方のひと休み・軽く一杯")


def dinner_text(shop: dict) -> str:
    return lunch_text(shop, "今夜の一軒目").replace("🍴", "🍽")


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
# 代表 10/13「どういう問いかけ投稿が、視聴者の反応がよいか、以降の投稿に反映していって」。
# 返信が多かった形（10/13 時点。いちばんは「出張で1泊、夜は1軒だけ」の返信38）に寄せる：
# - 場面をはっきり書く（だれと・どこで・何人で・どんな時）
# - 「1軒だけ」「1つだけ選ぶなら？」と、答えを1つに絞らせる
# - 地元の人の好み・行きつけを聞く
# - 選択肢の外の答え（店名だけ・ひとことでも）を書きやすくする一文で締める
# - 「〆何派」「接待の決め手」のように、選び方・好みの種類を聞く問いは返信0件（10/18 運用部・福井担当の集計）。お店を1軒挙げてもらう形にする
# - 選択肢は3〜4個まで。「どうやって探してます？」のように、やり方を聞く問いは返信が少ない（10/9 は返信2）
# 数字（10/4〜10/13）：14:30 枠の平均は返信8.0・閲覧1,115、ほかの投稿は返信0.05・閲覧118（運用部・福井担当の集計）
# 運用部・福井担当の反応集計で効く形がわかったら、ここに足す。
QUESTIONS = [
    """福井駅前で、県外の友だちと晩ごはん1回だけ。外せないのって、結局どれですか？

・ソースカツ丼
・おろしそば
・地魚と地酒
・焼き鳥

どれも捨てがたくて決めきれない…。
地元の人、「ここだけは連れていけ」って一軒を教えてください！
選択肢にない答えも大歓迎です。""",
    """片町で二次会、10人。1軒だけ選ぶなら、どんなお店にしますか？

・広めのバー
・カラオケのあるスナック
・個室のある居酒屋

当日に慌てがちなので、幹事をしたことがある地元の人の「ここなら間違いない」一軒を聞きたいです。
選択肢にない答えも大歓迎です。""",
    """福井駅前で、はじめての一人飲み。最初の1軒だけ選ぶなら？

・カウンターの居酒屋
・焼き鳥屋
・バー
・立ち飲み

一人だと最初の一軒に入るのが少し勇気いる…。
地元の人の「一人でも入りやすい」1軒を教えてください。お店の名前だけでもOKです！""",
    """片町で飲んだあと、〆に1軒だけ寄るなら、どこに行きますか？

ラーメン、おろしそば、お茶漬け…
飲んだあとの一杯、地元の人がいつも寄る1軒を教えてください。
お店の名前だけでもOKです！""",
    """出張で福井駅前に1泊。夜は1軒だけ行けるとしたら、どこに行きます？

・地魚の刺身と地酒
・ソースカツ丼でさっと
・越前がにが出るお店（冬）
・ホテル近くのバー

初めての福井で迷う人が多いと思うので、地元の人の答えを聞かせてください。
選択肢にない答えも大歓迎です。""",
    """福井駅前で、平日のランチ1,000円前後。1軒だけ選ぶなら、どこに行きますか？

定食、そば、洋食、中華…
候補が多いようで、いざ探すと決めきれない…。
地元の人がいつも行く1軒を教えてください。お店の名前だけでもOKです！""",
    """県外からのお客さんを、福井駅前で1軒だけ案内するなら、どこにしますか？

・地魚と地酒のお店
・個室のある和食
・駅から歩いてすぐのお店

地元の人の「ここなら間違いない」1軒を教えてください。
選択肢にない答えも大歓迎です。""",
    """何年も通っている片町のお店、1軒だけ挙げるなら、どこですか？

長く続いているお店ほど、通う理由があると思うんです。
「〇年通ってる」「ここが好き」のひとことも添えてもらえるとうれしいです。""",
    """福井駅前で、待ち合わせまで30分。カフェを1軒だけ選ぶなら？

・ゆっくり座れるお店
・おしゃべりしやすいお店
・甘いものが目当て
・テイクアウトでさっと

地元の人の「時間つぶしはここ」を教えてください。
選択肢にない答えも大歓迎です。""",
    """雨の日の福井駅前。傘をささずに行けるごはん屋さんを1軒だけ挙げるなら、どこですか？

駅の近くで、濡れずに入れるお店があると助かる…。
地元の人の「雨の日はここ」を教えてください。お店の名前だけでもOKです！""",
    """福井駅に着いて、帰りの電車まで1時間。1軒だけ寄るなら、どこにしますか？

・さっと食べられる定食・そば
・駅前で一杯
・お土産も買えるお店

旅の人に教えたい地元の1軒を聞かせてください。
選択肢にない答えも大歓迎です。""",
    """親が福井に遊びに来た夜。福井駅前で晩ごはんを1軒だけ選ぶなら、どこにしますか？

・地魚と地酒のお店
・落ち着いた和食
・みんなで分けられる居酒屋

家族を連れていくならここ、という1軒を教えてください。
お店の名前だけでもOKです！""",
    """給料日の金曜日。片町で1軒だけ、ちょっと贅沢するなら？

・カウンターのお鮨
・焼肉
・ワインのおいしいお店
・いいバー

地元の人の「ごほうびの日はここ」を教えてください。
選択肢にない答えも大歓迎です。""",
    """冷えこんだ夜。福井駅前で温まりに1軒だけ入るなら、どこにしますか？

・おでん
・鍋
・ラーメン
・熱燗のおいしい居酒屋

寒い日に思い出す1軒を教えてください。
お店の名前だけでもOKです！""",
    """友だち4人で女子会。福井駅前・片町のお店を1軒だけ選ぶなら？

・個室のある居酒屋
・イタリアン・バル
・甘いものもあるカフェ

地元の人の「ここなら盛り上がる」1軒を聞かせてください。
選択肢にない答えも大歓迎です。""",
    """送別会の二次会。片町で1軒だけ選ぶなら、どこにしますか？

・カラオケのあるスナック
・ゆっくり話せるバー
・もう一軒、居酒屋

幹事をしたことがある人の「ここなら間違いない」1軒を教えてください。
選択肢にない答えも大歓迎です。""",
    """日曜のお昼。家族で福井駅前のお店に入るなら、1軒だけどこにしますか？

・子どもも食べやすい洋食
・そば・うどん
・ソースカツ丼

家族で行きやすい1軒を教えてください。
お店の名前だけでもOKです！""",
    """恐竜博物館の帰り、福井駅前で晩ごはん。1軒だけ行くなら、どこにしますか？

・福井らしい地魚
・ボリュームのある定食
・駅から近い居酒屋

観光の人に教えたい地元の1軒を聞かせてください。
選択肢にない答えも大歓迎です。""",
    """福井駅前・片町で、初めてのデート。お店を1軒だけ選ぶなら？

・雰囲気のいいイタリアン
・カウンターの和食
・静かなバー

地元の人の「ここなら安心」の1軒を教えてください。
お店の名前だけでもOKです！""",
    """雪の日でも、つい行きたくなる福井駅前のお店。1軒だけ挙げるなら、どこですか？

駅から近くて、寒い日に恋しくなるお店。地元の人の答えを聞かせてください。
お店の名前だけでもOKです！""",
    """仕事帰り、一人でさっと一杯。福井駅前で1軒だけ寄るなら、どこにしますか？

・立ち飲み
・カウンターの居酒屋
・焼き鳥
・バー

地元の人のいつもの1軒を教えてください。
選択肢にない答えも大歓迎です。""",
    """福井駅前で朝ごはん・モーニング。1軒だけ挙げるなら、どこですか？

・喫茶店のモーニング
・パン屋さん
・朝からやっている定食

朝が早い日に寄る1軒を教えてください。
お店の名前だけでもOKです！""",
    """県外の人に、ソースカツ丼を1軒だけすすめるなら、福井駅前のどこにしますか？

「ここで食べてほしい」という1軒を、地元の人に聞きたいです。
お店の名前だけでもOKです！""",
    """おろしそばを1杯だけ食べるなら。福井駅前・片町のどこに行きますか？

地元の人がいつも行く1軒を教えてください。
お店の名前だけでもOKです！""",
    """誕生日のお祝い。福井駅前・片町のお店を1軒だけ選ぶなら？

・コースのあるお店
・ケーキも頼めるお店
・個室のある和食

お祝いならここ、という1軒を聞かせてください。
選択肢にない答えも大歓迎です。""",
    """新幹線で来た友だちと、福井駅から歩いて行ける1軒。選ぶなら、どこにしますか？

・地魚と地酒
・ソースカツ丼
・駅前のバル

駅に着いてすぐ案内したい1軒を教えてください。
選択肢にない答えも大歓迎です。""",
]


def first_line(text: str) -> str:
    return text.split("\n", 1)[0].strip()


def question_text(day: date, used: dict[str, str] | None = None) -> str:
    """出したことのない問いを先に。全部出したら、いちばん前に出したものから（10/25：同じ文の出し直しは閲覧が 2,391→79 に落ちた）。
    used は「1行目 → 最後に出した日」。1行目が同じなら同じ問いとみなす。"""
    used = used or {}
    start = (day - date(2026, 10, 8)).days % len(QUESTIONS)
    order = QUESTIONS[start:] + QUESTIONS[:start]
    return min(order, key=lambda q: used.get(first_line(q), ""))


def used_questions(items: list[dict]) -> dict[str, str]:
    """キューにある（出た・出る予定の）14:30 の問いの、1行目と日付"""
    heads = {first_line(q) for q in QUESTIONS}
    out: dict[str, str] = {}
    for i in items:
        h = first_line(i.get("text", ""))
        if h in heads:
            out[h] = max(out.get(h, ""), str(i.get("scheduled_at", ""))[:10])
    return out


WEEKDAYS = "月火水木金土日"


# 祝日（代表 10/8「今週末は3連休、10/12（月）は祝日です。」）。年が変わる前に足す
HOLIDAYS = {
    date(2026, 10, 12), date(2026, 11, 3), date(2026, 11, 23),
    date(2027, 1, 1), date(2027, 1, 11), date(2027, 2, 11), date(2027, 2, 23), date(2027, 3, 22),
    date(2027, 4, 29), date(2027, 5, 3), date(2027, 5, 4), date(2027, 5, 5), date(2027, 7, 19),
    date(2027, 8, 11), date(2027, 9, 20), date(2027, 9, 23), date(2027, 10, 11), date(2027, 11, 3), date(2027, 11, 23),
}


# 期間中は自動の枠に出さないお店（手で入れた紹介と重ねないため）。slug → この日まで
HOLD_UNTIL = {
    # 片町昼バル（11/1）の参加5店。運用部・福井が紹介を手で入れている（代表 10/24「各店の単体の紹介投稿も織り交ぜること」）
    "s32a38885": date(2026, 11, 1), "se36ce584": date(2026, 11, 1), "s7407b590": date(2026, 11, 1),
    "sceb510ce": date(2026, 11, 1), "sbe378692": date(2026, 11, 1),
}

# 手で入れた投稿がある日は、その本数だけ自動の枠を減らす（1日の本数を増やさない。代表 10/24）。この順に外す
DROP_ORDER = ("16:30", "14:30")

# 有料でも PR の枠に出さないお店（テスト運用中）
NO_PR = {
    "s18e7a90b",  # &Room（10/5 本番確認のあと、運営設定で有料に戻した。テスト運用中なので投稿しない。引き継ぎの記録）
}

# 昼に営業していないお店。お昼の枠に出さない
NO_LUNCH = {
    "se336a944",  # 寿司政（代表 10/12「寿司政は昼営業していません。」）
}


def open_on(shop: dict, day: date) -> bool:
    """定休日の欄にその曜日がある店は、その日は出さない（10/6 GINCHIYO は火曜定休）。祝日は「祝」がある店を出さない。"""
    holiday = shop.get("holiday") or ""
    if WEEKDAYS[day.weekday()] in holiday:
        return False
    return not (day in HOLIDAYS and "祝" in holiday and "祝日は営業" not in holiday and "祝日営業" not in holiday)


def opens_by_noon(shop: dict) -> bool:
    """サイトに出ている営業時間（hours）がいちばん早くても15時からの店は、お昼の枠に出さない。
    代表 10/13「エキマエサイトで確認でいいです」：Google には問い合わせず、サイトのお店データで確かめる。営業時間が無い店はそのまま。"""
    times = [int(h) for h, _ in re.findall(r"(\d{1,2})[:：](\d{2})", shop.get("hours") or "")]
    return not times or min(times) < 15


def compose(day: date, shops: list[dict], featured: dict, manual: int = 0, used_q: dict[str, str] | None = None) -> list[dict]:
    # 試験用の複製（slug が -gtest で終わる。例：洋食堂の Google 表示テスト）は投稿に出さない。有料にしても PR に選ばない
    shops = [s for s in shops if not s["slug"].endswith("-gtest") and not (s["slug"] in HOLD_UNTIL and day <= HOLD_UNTIL[s["slug"]])]
    rng = random.Random(day.isoformat())
    seen = set(featured.get("seen", []))
    pr_last = featured.get("pr_last", {})
    gourmet = [s for s in shops if s["category"] == "gourmet" and eligible(s) and open_on(s, day)]
    night = [s for s in shops if s["category"] == "night" and eligible(s) and open_on(s, day)]
    paid_due = sorted(
        (s for s in shops if s.get("is_paid") and s["slug"] not in NO_PR and open_on(s, day) and
         (s["slug"] not in pr_last or (day - date.fromisoformat(pr_last[s["slug"]])).days >= PR_INTERVAL_DAYS)),
        key=lambda s: pr_last.get(s["slug"], ""))
    drink = ("居酒屋", "焼鳥・串")
    cafe = [x for x in gourmet if x["genre"] == "カフェ・スイーツ"]
    # お昼の枠に居酒屋は出さない（夜だけの店が多い。10/5 しの﨑の件）
    lunch = [x for x in gourmet if x["genre"] != "カフェ・スイーツ" and x["genre"] not in drink
             and x["slug"] not in NO_LUNCH and x.get("lunch") != "なし" and opens_by_noon(x)]
    evening = [x for x in gourmet if x["genre"] in drink]
    dinner = [x for x in gourmet if x["genre"] != "カフェ・スイーツ"]

    slots: list[tuple[str, str]] = []

    dropped = set(DROP_ORDER[:manual])

    def add(hm: str, pool: list[dict], make) -> None:
        if hm in dropped:
            return
        if (s := pick(pool, seen, rng)):
            seen.add(s["slug"]); slots.append((hm, make(s)))

    add("11:30", lunch or gourmet, lunch_text)
    if "14:30" not in dropped:
        q = question_text(day, used_q)
        slots.append(("14:30", q))
        if used_q is not None:
            used_q[first_line(q)] = day.isoformat()
    if "16:30" in dropped:
        pass
    elif paid_due:
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
        item_id = f"p-{at:%Y%m%d%H%M}-{digest}"
        items.append({"id": item_id, "text": with_utm(text, f"{hm.replace(':', '')}", item_id), "scheduled_at": at.isoformat()})
    return items


SLOT_TIMES = ("11:30", "14:30", "16:30", "18:30", "20:30")


def filled(day: date, existing: list[dict]) -> bool:
    """その日の自動の枠がもうキューにあるか。手で足した投稿（21:00 の紹介など）や読者への返事は数えない（10/23 くじらの件）。"""
    return any(str(i.get("scheduled_at", ""))[:16] in {f"{day.isoformat()}T{t}" for t in SLOT_TIMES}
               and not i.get("reply_to_id") for i in existing)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="この日のぶんを作る（既定は翌日。日付をまたいで遅れて動いたときは今日のぶんも）")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    now = datetime.now(TZ)
    if a.date:
        days = [date.fromisoformat(a.date)]
    else:
        # GitHub の schedule は遅れることがあり、日付をまたぐと「翌日」がずれて1日飛ぶ（10/23 の件）。
        # 朝 11 時より前に動いたときは、今日のぶん（まだ全部これからの枠）も作る
        days = ([now.date()] if now.hour < 11 else []) + [(now + timedelta(days=1)).date()]

    existing = [json.loads(l) for l in QUEUE.read_text(encoding="utf-8").splitlines() if l.strip()] if QUEUE.exists() else []
    featured = load_json(FEATURED, {"seen": [], "pr_last": {}})
    shops = None
    added = []
    used_q = used_questions(existing)
    for day in days:
        if filled(day, existing):
            print(f"{day} のぶんはもうキューにあります。足しません。")
            continue
        shops = shops if shops is not None else load_shops()
        manual = sum(1 for i in existing if str(i.get("scheduled_at", "")).startswith(day.isoformat()) and not i.get("reply_to_id"))
        items = compose(day, shops, featured, manual, used_q)
        for it in items:
            print(f"── {it['scheduled_at']}\n{it['text']}\n")
        added += items
    if a.dry_run or not added:
        return
    with QUEUE.open("a", encoding="utf-8") as f:
        for it in added:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    FEATURED.write_text(json.dumps(featured, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(added)} 本を予約しました。")


if __name__ == "__main__":
    main()
