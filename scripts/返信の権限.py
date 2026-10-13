"""読者の返信に @fukui_ekimae から返事を出せるかを、投稿せずに確かめる（読むだけ）。

代表 10/13「まず、出せるか確認を。」（統括経由）。
- 返信を読めるか（threads_read_replies）：14:30 の問いかけ投稿の /replies を読む
- 返事の上限（reply_quota_usage）を読めるか
- 読者の返信を管理できるか（threads_manage_replies）は、返事を出さないと確かめられないので、
  読んだときのエラーの文面で判断する
本文や読者の名前は出さない（数と、読めたか・エラーかだけ）。
使い方: THREADS_ACCESS_TOKEN=xxx python scripts/返信の権限.py
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://graph.threads.net/v1.0"
ROOT = Path(__file__).resolve().parent.parent


def get(path: str, **params) -> dict:
    params["access_token"] = os.environ["THREADS_ACCESS_TOKEN"]
    try:
        with urllib.request.urlopen(f"{API}/{path}?{urllib.parse.urlencode(params)}", timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode()).get("error", {})
        except ValueError:
            err = {}
        return {"error": {"status": e.code, "code": err.get("code"), "type": err.get("type"), "message": (err.get("message") or "")[:200]}}


def main() -> None:
    posted = json.loads((ROOT / "state/posted.json").read_text())["posted"]
    qs = [(k, v) for k, v in posted.items() if k[-9:-5] == "1430"]
    k, v = sorted(qs, key=lambda x: x[1]["posted_at"])[-1]
    print(f"確かめた投稿：{k}（{v['permalink']}）")
    me = get("me", fields="id,username")
    print("アカウント：", me.get("username") or me)
    r = get(f"{v['post_id']}/replies", fields="id,timestamp,has_replies,is_reply_owned_by_me,hide_status")
    print("返信を読む（/replies）：", f"読めた {len(r.get('data', []))} 件" if "data" in r else r)
    c = get(f"{v['post_id']}/conversation", fields="id,is_reply_owned_by_me")
    print("会話全体を読む（/conversation）：", f"読めた {len(c.get('data', []))} 件" if "data" in c else c)
    q = get(f"{me.get('id', 'me')}/threads_publishing_limit", fields="quota_usage,config,reply_quota_usage,reply_config")
    print("投稿・返事の上限：", q)


if __name__ == "__main__":
    main()
