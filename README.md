# ふくいエキマエ

福井駅前・片町のグルメと夜のお店（バー・スナック・ラウンジ）のガイドサイトと、Threads **@fukui_ekimae** の運用の仕組みです。

- 公開サイト：`https://ekimae.fukui-fukui.com/`
- Supabase：プロジェクト `fukui-ekimae`（組織 YU_GBP・東京、ID `zynxnpwwmrxzyljrsmbs`）
- お店の管理画面：`/owner/`（運営が招待したお店の方だけ）
- 運営管理：`/admin/`（運営者だけ）
- 投稿予約：`/yoyaku/`（Threads の予約投稿。福井の仕組みと同じもの）

```
 公開サイト（GitHub Pages・静的）──読む──▶ Supabase（店のデータ・ログイン・写真）
 お店の管理画面 / 運営管理 ───読み書き──▶      ▲                ▲
                                              │ Webhook        │ 招待メール
 Stripe（月額1,000円・年額10,000円）──────────┘                │
 GitHub Actions ─ 毎晩：店のデータから翌日の投稿を作る ─▶ posts/queue.jsonl
                └ 10分おき：予約時刻が来た投稿を Threads へ
```

## プラン

| | 無料 | 有料（月額1,000円／年額10,000円・税込） |
|---|---|---|
| 公開される情報 | 店名・ジャンル・エリア・地図リンク・Instagram | 左に加えて、ひとこと・紹介文・営業時間・定休日・電話番号（タップで電話）・写真5枚・リンク10件 |
| 情報の変更 | 管理画面から「更新依頼」を送り、運営が反映 | 管理画面から自分で直接編集 |
| 一覧での表示 | 通常 | 上のほうに表示（PR表記つき・有料店同士は毎日並びを入れ替え） |
| Threads | 日々の紹介の対象 | 30日に1回、PR表記つきで紹介 |

お店の管理者は、運営がメールアドレスと店を紐付けて招待します（自分で新規登録はできません）。
招待メールのリンクを押すとログインでき、有料プランの申し込みもログイン後の画面から行います。

## 運営のしかた

| やりたいこと | 場所 |
|---|---|
| お店の人を登録する | 運営管理 →「店」→ 店を開く →「メールアドレスを紐付けて招待」。お店の公式アカウントの DM や店の電話で確かめたアドレスだけを登録する |
| 更新依頼に対応する | 運営管理 →「更新依頼」→「店を開く」で直してから「反映した」 |
| 掲載をやめる・閉店 | 店を開いて「非表示」にチェック |
| 問題のある写真を消す | 運営管理 →「写真」→「非表示にする」 |
| 無償で有料にする | 店を開いてプランと期限を手で設定（Stripe で契約した店は自動で更新されるので触らない） |
| 翌日の投稿を直す | 投稿予約（`/yoyaku/`）で編集。毎晩21時に翌日ぶんが自動で入る |

## 書体

- 本文：**DNP 秀英角ゴシック銀 Std**（Adobe Fonts。キット `qdm5ekk`、登録ドメイン `ekimae.fukui-fukui.com`）＋ **YakuHanJP**（約物を半角に）
- 夜の見出し：M PLUS Rounded 1c、英字：Jost（Google Fonts）
- 独自ドメインにしたら、[fonts.adobe.com](https://fonts.adobe.com/my_fonts#web_projects-section) のこのキットにドメインを足す（足さないと、そのドメインでは秀英角ゴシック銀が出ず、Zen Kaku Gothic New で表示される）

## セットアップ

### 1. Supabase

1. [Supabase](https://supabase.com/dashboard) で新しいプロジェクトを作る（リージョンは Tokyo）。
2. SQL Editor で、次の順に実行する。
   1. `supabase/migrations/0001_init.sql`（テーブル・権限・写真の保存先）
   2. `supabase/seed/shops_public.sql`（店の初期データ。公開項目のみ）
   3. `private/shops_private.sql`（住所・電話・出典。**リポジトリには入っていない**。運営の手元にあるものを使う）
3. Authentication → Sign In / Providers → Email：**Allow new users to sign up をオフ**。
4. Authentication → URL Configuration：
   - Site URL：`https://ekimae.fukui-fukui.com/`
   - Redirect URLs：`https://ekimae.fukui-fukui.com/owner/` と `https://ekimae.fukui-fukui.com/admin/`
5. Authentication → Emails：**SMTP を設定する**（Resend・Gmail など）。Supabase 標準のメール送信は1時間に数通までしか送れず、招待メールが届かなくなる。
   メールの文面（Invite user / Magic link）は日本語に書き換える。例：件名「ふくいエキマエ お店の管理画面へのご招待」。
6. Authentication → Users → Add user → Create new user で、運営者（`admins` 表のアドレス）を作る。
   「Auto Confirm User」にチェック。パスワードは使わないので長いランダムな文字列でよい。
   （新規登録をオフにしているので、ここで作っておかないとログイン用のメールが送れない）
7. Project Settings → API の **Project URL** と **anon public キー**を `docs/config.js` に書く（anon キーは公開してよい。service_role キーは書かない）。

### 2. Edge Functions（招待・Stripe・運営へのメール通知）

[Supabase CLI](https://supabase.com/docs/guides/cli) で：

```bash
supabase link --project-ref <プロジェクトID>
supabase functions deploy invite-owner create-checkout customer-portal
supabase functions deploy stripe-webhook --no-verify-jwt
supabase secrets set SITE_URL=https://ekimae.fukui-fukui.com/
```

Stripe の設定（次の 3.）が済んだら：

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_PRICE_MONTHLY=price_... STRIPE_PRICE_YEARLY=price_... \
  STRIPE_WEBHOOK_SECRET=whsec_...
```

Stripe のキーを入れるまでは、管理画面の申し込みボタンは「準備中」と表示される。

**お問い合わせ・更新依頼のメール通知**（届いたら運営にメールが来る）：

```bash
supabase functions deploy notify-admin --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_... NOTIFY_TO=yasu29fr@gmail.com \
  NOTIFY_FROM="ふくいエキマエ <info@送信に使うドメイン>" NOTIFY_WEBHOOK_SECRET=<長いランダムな文字列>
```

1. [Resend](https://resend.com) の API キーを使う（Auth の SMTP を Resend にしているなら同じキーでよい）。
   送信元のドメインを Resend で認証するまでは、`NOTIFY_FROM` を省くと `onboarding@resend.dev` から、
   Resend に登録したメールアドレス宛てにだけ送れる。
2. `supabase/migrations/0003_notify_admin.sql` のプロジェクトIDと合言葉を置き換えて、SQL Editor で実行する
   （お問い合わせ・更新依頼が入ったら notify-admin を呼ぶトリガー）。
3. サイトのお問い合わせフォームから送ってみて、メールが届くか確かめる。

### 3. Stripe

まず**テストモード**で一通り試してから、本番のキーに切り替える。

1. 商品カタログ → 商品「ふくふく 有料掲載プラン」を作り、価格を2つ追加する。
   - 1,000円（税込）・継続・毎月 → `price_...` を `STRIPE_PRICE_MONTHLY` に
   - 10,000円（税込）・継続・毎年 → `price_...` を `STRIPE_PRICE_YEARLY` に
2. 開発者 → Webhook → エンドポイントを追加
   - URL：`https://<プロジェクトID>.supabase.co/functions/v1/stripe-webhook`
   - イベント：`checkout.session.completed`、`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`
   - 署名シークレット（`whsec_...`）を `STRIPE_WEBHOOK_SECRET` に
3. 設定 → Billing → カスタマーポータル：「顧客がサブスクリプションをキャンセル」「支払い方法の更新」を有効にし、キャンセルは「請求期間の終了時」にする。
4. テスト用カード `4242 4242 4242 4242` で、申し込み → 有料になる → ポータルで解約 → 期間の終わりに無料に戻る、を確かめる。

### 4. GitHub

1. Settings → Pages：Branch `main`、フォルダ `/docs`。
2. Settings → Secrets and variables → Actions
   - **Variables**：`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SITE_URL`（毎晩の投稿づくりで店のデータを読む）
   - **Secrets**：`THREADS_USER_ID`、`THREADS_ACCESS_TOKEN`、`GH_PAT`（トークンの自動更新用）
3. 予約投稿の起動は、福井の仕組みと同じく外部の cron（cron-job.org など）から 10 分おきに
   `POST https://api.github.com/repos/yu-fukui/fukui-ekimae/dispatches`、本文 `{"event_type": "threads-tick"}` を送る。
   GitHub Actions の `schedule` は遅延・スキップがあるため、保険として残しているだけ。

### 5. Threads（@fukui_ekimae）

Meta for Developers でアプリを作り、Threads API の `threads_basic` と `threads_content_publish` を付けて、
@fukui_ekimae の長期アクセストークン（60日）を発行する。ユーザーID とトークンを上の Secrets に入れる。
トークンは `threads-refresh-token.yml` が毎週更新する。

## 店のデータを作り直す

調査で作った店のリスト（CSV）から、初期データを作り直せる。
リストは非公開の `yu-fukui/fukui-ekimae-data` で作る（`python3 scripts/merge.py` → `list/対象店舗.csv`）。

```bash
python scripts/build_seed.py ../fukui-ekimae-data/list/対象店舗.csv
```

`supabase/seed/shops_public.sql`（公開項目）、`private/shops_private.sql`（住所・電話・調べた営業時間と定休日。コミットしない）、
`docs/data/shops.json`（Supabase 未設定時の表示用）が更新される。同じ店（slug が同じ）は上書きされ、
オーナーが設定した Instagram は上書きしない。

## ロゴ・アイコン・共有画像

- ロゴ・ファビコン・ホーム画面のアイコンは、キャラクターのイラスト `brand/avatar-source.webp` から切り出したもの
  （`brand/avatar-circle.png`＝円、`avatar-face.png`＝顔の拡大（ファビコン用）、`avatar-square.png`＝円の内側の正方形（iPhone 用））。
  `docs/` の `logo-96.png`・`favicon-32/64.png`・`icon-192/512.png`・`apple-touch-icon.png` はこれを縮小したもの。
- SNS 共有画像は `brand/og.html` が下絵。直したら `node scripts/brand.js` で `docs/og.png` を作り直す。

## テスト

```bash
PYTHONPATH=src python -m unittest discover -s tests          # 投稿の仕組み・毎晩の投稿づくり
deno test --allow-env --allow-net supabase/functions/stripe-webhook/test.ts supabase/functions/notify-admin/test.ts   # Stripe 通知・メール通知
# 権限（RLS）：素の PostgreSQL に stub → migration → テストの順に流す
psql -f supabase/tests/stub_supabase.sql -f supabase/migrations/0001_init.sql -f supabase/tests/rls_test.sql
```

push すると `.github/workflows/test.yml` が同じテストを GitHub Actions で実行する。

## ファイル構成

```
docs/                    公開サイト（GitHub Pages）
  index.html app.js styles.css config.js
  owner/                 お店の管理画面（無料：更新依頼 / 有料：編集・写真・リンク・契約）
  admin/                 運営管理（依頼・問い合わせ・店の編集・招待・写真）
  yoyaku/                Threads の投稿予約画面
  lib/                   管理画面の共通部品（Supabase 接続・画像の縮小）
  data/shops.json        Supabase 未設定時の表示用データ（公開項目のみ）
  terms.html tokushoho.html privacy.html
supabase/
  migrations/0001_init.sql   テーブル・権限（RLS）・写真の保存先
  seed/shops_public.sql      店の初期データ（公開項目）
  functions/                 invite-owner / create-checkout / customer-portal / stripe-webhook / notify-admin
  tests/                     権限のテスト
scripts/
  build_seed.py          調査リスト → 初期データ
  compose.py             店のデータ → 翌日の投稿3本
  commit_file.sh
src/threads_bot/         Threads への投稿（福井の仕組みから移植）
posts/queue.jsonl        投稿キュー
state/                   投稿済み・紹介済みの記録
```
