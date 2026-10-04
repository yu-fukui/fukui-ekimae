# 運用部 引き継ぎ書｜ふくふく | 福井エキマエ

ふくふくプロジェクトの「駅前・片町」担当。Threads アカウント @fukui_ekimae と
サイト「ふくいエキマエ」（https://ekimae.fukui-fukui.com/ ）の日々の運用をまとめる。
（2026-10-04 時点。開発側のセッションから運用部へ引き継ぎ）

## 1. 名前とブランド

| もの | 名前 |
|---|---|
| プロジェクト（運営者名） | ふくふくプロジェクト |
| サイト | ふくいエキマエ（ロゴの英字は FUKUFUKU PROJECT） |
| Threads の表示名 | ふくふく \| 福井エキマエ（@fukui_ekimae） |
| 姉妹 | ふくいおでかけ（https://odekake.fukui-fukui.com/ ）／Threads ふくふく \| 福井おでかけ（@fukui._.fukui） |

- 公式の団体（福井駅前商店街振興組合、一般社団法人 EKIMAE MALL、まちづくり福井、福福茶屋など）と
  間違われない言い方をする。公式・提携をにおわせない。
- 将来は求人・住宅にも広げる予定（同じ「ふくふく | 福井○○」＋サブドメインの形）。

## 2. アカウントの方針

- 誰に：駅前・片町で新しいお店を開拓したい地元の人／出張・旅行で福井らしい一軒を探す人／
  二次会・接待のお店選びに悩む幹事さん
- 何を：駅前と片町の約1,000店から「今日どこで食べる？どこで飲む？」のヒントを毎日届ける
- アカウント紹介の投稿（固定推奨）：https://www.threads.com/@fukui_ekimae/post/DeD29OUlTLi
- 守ること
  - 夜のお店（バー・スナック・ラウンジ）の投稿には「※20歳未満の飲酒は法律で禁止されています」
  - 有料掲載のお店は「PR」と明記する（ステマ規制）
  - Instagram の写真は使わない。文章とリンクだけ（写真の権利はお店にある）
  - 事実（店名・ジャンル・エリア・公式アカウント・お店が書いた紹介文）以外を書き足さない

## 3. 投稿の仕組み

| 時刻 | 何が動くか |
|---|---|
| 毎晩 21:00 | `threads-compose.yml` が翌日 3 枠を `posts/queue.jsonl` に足す |
| 11:30 | ランチ（駅前・片町のグルメ） |
| 17:30 | 有料のお店の紹介（PR、30日に1回）。なければ夕方のカフェ・軽く一杯 |
| 20:30 | 夜のお店 |
| 10分おき | cron-job.org → `repository_dispatch: threads-tick` → `threads-post.yml` が時刻の来た投稿を出す |
| 毎週月曜 12:00 | `threads-refresh-token.yml` がトークンの期限を延ばし、`GH_PAT` で Secret に書き戻す |

- 翌日の投稿は予約画面 https://ekimae.fukui-fukui.com/yoyaku/ で投稿時刻まで直せる（代表が使う）
- 投稿の記録：`state/posted.json`（permalink つき）。紹介済みの店：`state/featured.json`（全店一巡まで同じ店を出さない）
- 手で投稿を足すとき：`posts/queue.jsonl` に `{"id","text","scheduled_at","thread"[]}` を足し、
  `PYTHONPATH=src python3 -m threads_bot validate` を通してから main に入れる。
  ID は `p-YYYYMMDDHHMM-xxxx`。決まった3枠の合間（例：19:00）に入れてよい
- **時刻が過ぎた予約はまとめて出てしまう**（遅れの上限がない）。止まっていた後に再開するときは、
  過ぎた分（特に「きょうのお昼」など時間に結びつく文面）を先に外す
- 投稿のリンクは `https://ekimae.fukui-fukui.com/#/shop/<slug>`（以前 `/#/shop/…` と途中から始まる不具合があり、10/4 に修正済み）

### GitHub（yu-fukui/fukui-ekimae → Settings → Secrets and variables → Actions）

| Secret | 中身 |
|---|---|
| `THREADS_USER_ID` | 28514873358177734（@fukui_ekimae） |
| `THREADS_ACCESS_TOKEN` | 長期トークン（60日、毎週自動更新） |
| `GH_PAT` | トークン書き戻し用（Secrets: Read and write、yu-fukui で発行） |

- Variables `SITE_URL` 等は未設定でも既定値で動く
- cron-job.org のジョブ「ekimae threads-tick」は、yu-fukui の別の PAT（Contents: Read and write）を使う
- Meta のアプリはおでかけと共用。@fukui_ekimae は Threads テスターとして追加済み

## 4. サイトとお店のデータ

- データは Supabase（プロジェクト `fukui-ekimae`、id `zynxnpwwmrxzyljrsmbs`）の `shops`。
  公開は `public_shops` ビュー。直すとサイトにすぐ反映される
- 表記ルール
  - ホテルの中のお店は「店名（ホテル名）」。読み仮名も店名→ホテル名の順（例：SUBSTANCE（コートヤード・バイ・マリオット福井））
  - ジャンルの直しは代表の指示で `shops.genre` を更新（例：Sincere Lily → その他）
- 片町ガイド（https://ekimae.fukui-fukui.com/katamachi/ ）のお店一覧は `katamachi-guide.yml` が毎朝作り直す
- お問い合わせ・更新依頼の通知：Edge Function `notify-admin` → Resend（差出人 `ふくいエキマエ <info@fukui-fukui.com>`）→ yasu29fr@gmail.com。
  新しいドメインなので迷惑メールに入りやすい（代表の Gmail はフィルタで対応済み）。お店を招待するときは「迷惑メールも見てください」と伝える
- 管理画面：https://ekimae.fukui-fukui.com/admin/ （運営）、/owner/（お店）

## 5. 進行中の作業

- **Instagram 店チェック**：https://claude.ai/artifact/5pY3SZSFAU1hbaB2YATNV4
  - Instagram のある 279 店。確認済み・閉店のチェック、最新投稿 URL、Google マップ検索リンク
  - チェック結果はページの db（collection `checks`、doc id = slug）に入る。ArtifactData で読める
  - 閉店にチェックされた店 → 代表に確認してからサイトから外す
  - 最新投稿 URL が貼られた店 → 投稿の説明文を読み（`facebookexternalhit` の UA で og:description が取れる）、
    自分の言葉で短くまとめた紹介投稿を作って予約する
  - Instagram へのアクセスはすぐ 429（回数制限）になる。まとめて機械的に見に行かない
- **Google Places API**：代表が申請中。通ったら全店の営業状態（閉業）をまとめて確かめる。
  Google マップの画面を機械で検索するのは規約違反なのでしない
- **最初の定期投稿**：10/4 17:30（Paleo Brew Cafe）が新しいトークンで出るかを確認する
- Stripe の商品名「ふくふく 有料掲載プラン」の変更は任意（代表が Stripe 画面で）

## 6. 進め方

- 代表への説明は日本語で、専門用語を避け、作業は1つずつ指示する
- サイトや Supabase を変えるときは、変更前に内容を確かめ、変えたら表示で確認する
- リポジトリへの変更は作業ブランチ → PR → main（代表の指示があればマージまで行う）
